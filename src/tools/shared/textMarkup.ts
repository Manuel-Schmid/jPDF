import type { Command } from '../../core/session/history.svelte'
import type { Annotation, Quad, TextMarkupAnnotation } from '../../core/session/model'
import { isEditable } from '../../core/session/model'
import { addAnnotations, compositeCommand, deleteAnnotations, mergeAnnotations, updateAnnotation } from '../../core/session/commands'
import { cutQuads, findMergeableTextMarkup, isTextMarkup, mergeHighlightQuads, sameStyle } from '../../core/geometry/merge'
import { rectsToQuads, type ScreenRect } from '../../core/geometry/quads'
import { settings } from '../../core/settings/settings.svelte'
import { onTouchCancel, penNear } from '../../core/viewer/Overlay.svelte'
import { textLayerFor, textLayers, type TextLayerPage } from '../../core/viewer/textLayers'
import { startTextDrag, textReach, type TextDrag } from './textDrag'

/**
 * Text markup tools (marker text mode, underline, strike-out): the native
 * selection on the text layers is turned into annotations on pointerup.
 * Tools that preview their result (underline, strike-out) also rebuild it
 * while the selection is dragged out, at most once per frame.
 */

/**
 * Client rects of the selected text inside `root` (text nodes only, so no
 * element boxes). Visits only the text nodes from the range's start to its
 * end, not the whole layer: previews run this every frame of a drag.
 */
function selectedTextRects(range: Range, root: Element): ScreenRect[] {
  const out: ScreenRect[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const start = range.startContainer
  let n: Node | null
  if (start !== root && root.contains(start)) {
    walker.currentNode = start
    n = start.nodeType === Node.TEXT_NODE ? start : walker.nextNode()
  } else {
    n = walker.nextNode()
  }
  for (; n; n = walker.nextNode()) {
    // Text nodes after the range's end: none of the rest is selected.
    if (range.comparePoint(n, 0) > 0) break
    if (!range.intersectsNode(n)) continue
    const part = root.ownerDocument.createRange()
    part.selectNodeContents(n)
    if (n === range.startContainer) part.setStart(n, range.startOffset)
    if (n === range.endContainer) part.setEnd(n, range.endOffset)
    out.push(...Array.from(part.getClientRects()))
  }
  return out
}

/** The native selection, or any ranges (e.g. one built from caret positions). */
export type Ranges = Pick<Selection, 'rangeCount' | 'getRangeAt'>

/**
 * One annotation per text layer (page) the selection touches, built by `make`
 * from that page's merged quads (and, for tools that look at the page under
 * the text, the layer element and the selected text's client rects). Pages
 * whose selected text yields no quad are skipped.
 */
export function markupFromSelection<T extends TextMarkupAnnotation>(
  sel: Ranges,
  make: (page: number, quads: Quad[], source: { layer: Element; rects: ScreenRect[] }) => T,
  layers: Iterable<[Element, TextLayerPage]> = textLayers(),
): T[] {
  const out: T[] = []
  for (const [el, info] of layers) {
    const rects: ScreenRect[] = []
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i)
      if (range.intersectsNode(el)) rects.push(...selectedTextRects(range, el))
    }
    const quads = rectsToQuads(rects, info.toPdf)
    if (quads.length > 0) out.push(make(info.page, quads, { layer: el, rects }))
  }
  return out.sort((a, b) => a.page - b.page)
}

/** Returns a clone of `range` with trailing whitespace characters trimmed from its end. */
export function trimTrailingWhitespace(range: Range): Range {
  const out = range.cloneRange()
  if (out.collapsed) return out
  if (out.endContainer.nodeType === Node.TEXT_NODE) {
    const text = out.endContainer.nodeValue ?? ''
    const floor = out.endContainer === out.startContainer ? out.startOffset : 0
    let end = out.endOffset
    while (end > floor && /\s/.test(text[end - 1])) end--
    if (end > floor) {
      out.setEnd(out.endContainer, end)
      return out
    }
    if (out.endContainer === out.startContainer) {
      out.setEnd(out.startContainer, floor)
      return out
    }
  }
  const root = out.commonAncestorContainer
  const nodes: Text[] = []
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (out.comparePoint(n, 0) > 0) break
    if (out.intersectsNode(n)) nodes.push(n as Text)
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    const text = node.nodeValue ?? ''
    const start = node === out.startContainer ? out.startOffset : 0
    let end = node === out.endContainer ? out.endOffset : text.length
    while (end > start && /\s/.test(text[end - 1])) end--
    if (end > start) {
      out.setEnd(node, end)
      return out
    }
  }
  out.collapse(true)
  return out
}

function trimmedRanges(sel: Selection): Ranges {
  const trimmed: Range[] = []
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = trimTrailingWhitespace(sel.getRangeAt(i))
    if (!r.collapsed) trimmed.push(r)
  }
  return {
    rangeCount: trimmed.length,
    getRangeAt: (i) => trimmed[i],
  }
}

/** A non-empty selection, or null. */
function currentSelection(): Selection | null {
  const sel = window.getSelection()
  return sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel : null
}

/** A second press this soon (ms) and close (px) after the last is a double/triple click. */
const MULTI_CLICK_MS = 500
const MULTI_CLICK_PX = 6

/**
 * The text layer a press selects in: the one it landed on, or, for a press
 * the overlay took (no hover before a touch, or a stale hover), the layer
 * of its page when the press is within reach of text there.
 */
function pressLayer(e: PointerEvent, t: Node): [Element, TextLayerPage] | null {
  for (const entry of textLayers()) if (entry[0].contains(t)) return entry
  const hit = textLayerFor(t)
  return hit && textReach(hit[0], hit[1], e.clientX, e.clientY) === 'near' ? hit : null
}

/**
 * Calls `commit` with the native selection when a pointer is released after
 * a left-button press inside a text layer (the overlay does not see that
 * pointerup: it lets input through to the text layer). The selection is
 * cleared when `commit` returns true. Returns the detach function.
 *
 * Mouse and pen presses near text drag the selection out themselves (see
 * startTextDrag); touch, Shift+click and double/triple clicks (word and
 * line selection) keep the browser's native selection.
 *
 * With `preview`, it is called while that gesture changes the selection
 * (batched to one call per animation frame, null for an empty selection)
 * and with null when the gesture ends or the listener is detached.
 *
 * While `active()` is false no press starts a selection (a tool that stays
 * attached in a mode that draws instead, like the marker in freehand mode).
 *
 * Only the pointer that pressed ends the gesture, and a palm touching down
 * while a pen is in range is ignored (as on the overlay), so neither cuts a
 * pen's drag off part-way. A pen drag the browser cancels (pointercancel
 * instead of pointerup) commits what it had selected; other cancelled
 * gestures clear it. Either way no uncommitted selection is left behind.
 */
export function listenForTextSelection(
  commit: (sel: Selection) => boolean,
  preview?: (sel: Ranges | null) => void,
  active: () => boolean = () => true,
): () => void {
  // Only a selection dragged out inside a text layer counts: Ctrl+A followed by a
  // click on the toolbar must not mark the whole document.
  let startedInText = false
  let pointerType = ''
  /** The pointer of the gesture in progress (see onPointerUp). */
  let pointerId: number | undefined
  let isMultiClick = false
  let frame: number | null = null
  let previewing = false
  let drag: TextDrag | null = null
  let lastPress: { t: number; x: number; y: number } | null = null

  function endDrag(x?: number, y?: number) {
    const d = drag
    drag = null
    d?.end(x, y)
  }

  function stopPreview() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    if (previewing) preview?.(null)
    previewing = false
  }
  function onSelectionChange() {
    if (!startedInText || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!startedInText) return
      previewing = true
      const sel = currentSelection()
      const next = sel && isMultiClick ? trimmedRanges(sel) : sel
      preview!(next && next.rangeCount > 0 ? next : null)
    })
  }
  function onPointerDown(e: PointerEvent) {
    // Palm rejection: a hand resting on the screen while the pen marks must
    // not end the pen's drag (which would leave its selection half done).
    if (e.pointerType === 'touch' && penNear()) return
    const t = e.target
    stopPreview()
    endDrag()
    isMultiClick = false
    if (e.pointerType === 'touch' && !settings.data.preferences.drawWithFinger) {
      startedInText = false
      pointerType = ''
      return
    }
    pointerType = e.pointerType
    pointerId = e.pointerId
    // Right-button presses (temporary eraser) never select text.
    startedInText = e.button === 0 && t instanceof Node && active() && pressLayer(e, t) !== null
  }
  /**
   * Bubble phase, so a press the viewer took (Space or middle-button pan
   * stops it in the capture phase) never starts a drag.
   */
  function onPointerDownBubble(e: PointerEvent) {
    const press = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    const repeat =
      lastPress !== null &&
      press.t - lastPress.t < MULTI_CLICK_MS &&
      Math.hypot(press.x - lastPress.x, press.y - lastPress.y) <= MULTI_CLICK_PX
    lastPress = press
    isMultiClick = startedInText && repeat && !e.shiftKey
    const t = e.target
    if (!startedInText || e.defaultPrevented || e.shiftKey || repeat || !(t instanceof Node)) return
    const allowTouch = e.pointerType === 'touch' && settings.data.preferences.drawWithFinger
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen' && !allowTouch) return
    const hit = pressLayer(e, t)
    if (hit) drag = startTextDrag(e, hit[0], hit[1], textLayers)
  }
  /** Another pointer than the gesture's (a second finger, the mouse while the pen marks). */
  const otherPointer = (e: PointerEvent) => startedInText && e.pointerId !== pointerId

  function onPointerUp(e: PointerEvent) {
    if (otherPointer(e)) return
    finish(e.clientX, e.clientY)
  }
  /** Ends the gesture at client point (x, y), if given, and commits its selection. */
  function finish(x?: number, y?: number) {
    const fromText = startedInText
    const multiClick = isMultiClick
    startedInText = false
    pointerType = ''
    isMultiClick = false
    endDrag(x, y)
    stopPreview()
    if (!fromText) return
    const sel = currentSelection()
    if (!sel) return
    if (multiClick) {
      const trimmed = trimmedRanges(sel)
      sel.removeAllRanges()
      for (let i = 0; i < trimmed.rangeCount; i++) sel.addRange(trimmed.getRangeAt(i))
      if (sel.isCollapsed || sel.rangeCount === 0) return
    }
    if (commit(sel)) sel.removeAllRanges()
  }
  function onPointerCancel(e: PointerEvent) {
    if (otherPointer(e)) return
    // Windows Ink may cancel a pen stroke (e.g. taking it for a gesture):
    // the selection dragged out so far is what the pen marked.
    if (startedInText && pointerType === 'pen') return finish()
    const fromText = startedInText
    startedInText = false
    pointerType = ''
    isMultiClick = false
    endDrag()
    stopPreview()
    if (fromText) window.getSelection()?.removeAllRanges()
  }
  const stopTouchCancel = onTouchCancel(() => {
    if (pointerType !== 'touch') return
    startedInText = false
    pointerType = ''
    isMultiClick = false
    endDrag()
    stopPreview()
    window.getSelection()?.removeAllRanges()
  })
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerdown', onPointerDownBubble)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  if (preview) document.addEventListener('selectionchange', onSelectionChange)
  return () => {
    startedInText = false
    pointerType = ''
    isMultiClick = false
    endDrag()
    stopPreview()
    stopTouchCancel()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerdown', onPointerDownBubble)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    if (preview) document.removeEventListener('selectionchange', onSelectionChange)
  }
}

interface PageSource {
  byPage(page: number): Annotation[]
}

/**
 * Cuts `cut` out of each of `annotations` (text markup): an annotation keeps
 * what lies outside it (possibly in more pieces) or, with nothing left, is
 * deleted. Commands for the changed ones only; empty when nothing changes.
 */
export function cutMarkupCommands(
  annotations: readonly TextMarkupAnnotation[],
  cut: Quad[],
  modifiedAt: string,
): Command[] {
  const updates: Command[] = []
  const deleted: Annotation[] = []
  for (const a of annotations) {
    const quads = cutQuads(a.quads, cut)
    if (quads.length === a.quads.length && quads.every((q, i) => q === a.quads[i])) continue
    if (quads.length === 0) deleted.push(a)
    else updates.push(updateAnnotation(a, { ...a, quads, modifiedAt }))
  }
  return deleted.length > 0 ? [deleteAnnotations(deleted), ...updates] : updates
}

/**
 * Commit of new text markup (one per page). Markup of the same kind in
 * another style (colour, for highlights also opacity) loses the part under
 * the new markup, so re-marking replaces the old colour instead of mixing
 * with it or stacking a second line. Then each is merged into the
 * overlapping markup of the same style on its page (quads joined per line,
 * the oldest surviving), else added. Other kinds are left alone. One undo
 * step for all of it.
 */
export function textMarkupCommand<T extends TextMarkupAnnotation>(
  store: PageSource,
  fresh: T[],
): Command {
  const added: T[] = []
  const cuts: Command[] = []
  const merges: Command[] = []
  for (const m of fresh) {
    const page = store.byPage(m.page).filter(isEditable)
    const restyled = page.filter((a) => isTextMarkup(a) && a.kind === m.kind && !sameStyle(a, m)) as TextMarkupAnnotation[]
    cuts.push(...cutMarkupCommands(restyled, m.quads, m.modifiedAt))
    // The cut only changes markup of another style, so the merge candidates are unaffected.
    const found = findMergeableTextMarkup(page, m)
    if (found.length === 0) {
      added.push(m)
      continue
    }
    const [oldest, ...rest] = found
    const quads = mergeHighlightQuads([
      ...oldest.quads,
      ...rest.flatMap((a) => a.quads),
      ...m.quads,
    ])
    merges.push(mergeAnnotations(oldest, { ...oldest, quads, modifiedAt: m.modifiedAt }, rest))
  }
  if (cuts.length === 0 && merges.length === 0) return addAnnotations(added)
  return compositeCommand('Add annotation', [
    ...cuts,
    ...(added.length > 0 ? [addAnnotations(added)] : []),
    ...merges,
  ])
}
