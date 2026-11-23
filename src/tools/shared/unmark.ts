import type { Command } from '../../core/session/history.svelte'
import type { Annotation, HighlightAnnotation, Quad, RGB, TextMarkupAnnotation } from '../../core/session/model'
import { isEditable } from '../../core/session/model'
import { compositeCommand, deleteAnnotations, updateAnnotation } from '../../core/session/commands'
import { cutQuads } from '../../core/geometry/merge'
import type { ToolContext } from '../../core/registry/tools'
import { textLayers } from '../../core/viewer/textLayers'
import { markupFromSelection } from './textMarkup'

/**
 * Unmarking text with a right-button drag (text-selecting tools: marker text
 * mode, underline, strike-out). Browsers do not select text with the right
 * button, so the range is built from the caret positions under the press and
 * the pointer. While dragging, the range is tinted blue (a preview, not the
 * native selection); on release the tool's kind of markup is cut out of it.
 * A right click without a drag still opens the page menu.
 */

export type TextMarkupKind = TextMarkupAnnotation['kind']

/** Tint of the text being unmarked. */
export const UNMARK_COLOR: RGB = [0.259, 0.522, 0.957]
export const UNMARK_OPACITY = 0.35
/** Screen pixels the pointer must travel before a right press becomes an unmark drag. */
const DRAG_THRESHOLD_PX = 3
/** The context menu that follows the release of an unmark drag is swallowed within this time. */
const MENU_GUARD_MS = 500

interface Caret {
  node: Node
  offset: number
}

const inTextLayer = (n: Node) => [...textLayers()].some(([el]) => el.contains(n))

/** The caret in a text layer's text under client point (x, y); null elsewhere (gaps between lines, other elements). */
export function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?(x: number, y: number): Range | null
  }
  let caret: Caret | null = null
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) caret = { node: p.offsetNode, offset: p.offset }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y)
    if (r) caret = { node: r.startContainer, offset: r.startOffset }
  }
  return caret && caret.node.nodeType === Node.TEXT_NODE && inTextLayer(caret.node) ? caret : null
}

/** The range between two carets, in document order. */
function rangeBetween(a: Caret, b: Caret): Range {
  const r = document.createRange()
  r.setStart(a.node, a.offset)
  r.setEnd(a.node, a.offset)
  if (r.comparePoint(b.node, b.offset) < 0) r.setStart(b.node, b.offset)
  else r.setEnd(b.node, b.offset)
  return r
}

interface PageSource {
  byPage(page: number): Annotation[]
}

const isKind = (a: Annotation, kind: TextMarkupKind): a is TextMarkupAnnotation => a.kind === kind

/**
 * Cuts `cuts` (quads per page) out of the `kind` markup on those pages: an
 * annotation keeps what lies outside them (possibly in more pieces) or, with
 * nothing left, is deleted. One undo step; null when nothing changes.
 */
export function unmarkCommand(
  store: PageSource,
  kind: TextMarkupKind,
  cuts: { page: number; quads: Quad[] }[],
  modifiedAt = new Date().toISOString(),
): Command | null {
  const updates: Command[] = []
  const deleted: Annotation[] = []
  for (const { page, quads: cut } of cuts) {
    for (const a of store.byPage(page).filter(isEditable)) {
      if (!isKind(a, kind)) continue
      const quads = cutQuads(a.quads, cut)
      if (quads.length === a.quads.length && quads.every((q, i) => q === a.quads[i])) continue
      if (quads.length === 0) deleted.push(a)
      else updates.push(updateAnnotation(a, { ...a, quads, modifiedAt }))
    }
  }
  const parts = deleted.length > 0 ? [deleteAnnotations(deleted), ...updates] : updates
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : compositeCommand('Unmark text', parts)
}

/** Swallows the next context menu (the one the right-button release brings), for a moment. */
function swallowNextContextMenu() {
  const swallow = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    stop()
  }
  const timer = setTimeout(() => stop(), MENU_GUARD_MS)
  function stop() {
    window.removeEventListener('contextmenu', swallow, true)
    clearTimeout(timer)
  }
  window.addEventListener('contextmenu', swallow, true)
}

/**
 * Right-button unmark drags while `kind()` is non-null (the markup the active
 * tool makes). The tint is previewed through ctx.pagePreviews, rebuilt at most
 * once per animation frame. Returns the detach function.
 */
export function listenForUnmark(ctx: ToolContext, kind: () => TextMarkupKind | null): () => void {
  let drag: {
    pointerId: number
    kind: TextMarkupKind
    x: number
    y: number
    moved: boolean
    anchor: Caret | null
    focus: Caret | null
  } | null = null
  let frame: number | null = null

  function range(): Range | null {
    if (!drag?.anchor || !drag.focus) return null
    const r = rangeBetween(drag.anchor, drag.focus)
    return r.collapsed ? null : r
  }

  /** The range's quads per page (one entry per page with selected text). */
  function cuts(r: Range): HighlightAnnotation[] {
    return markupFromSelection({ rangeCount: 1, getRangeAt: () => r }, (page, quads) => ({
      id: `unmark-${page}`,
      page,
      sourceRef: null,
      modifiedAt: '',
      author: '',
      kind: 'highlight',
      quads,
      color: UNMARK_COLOR,
      opacity: UNMARK_OPACITY,
    }))
  }

  function preview() {
    frame = null
    const r = range()
    ctx.pagePreviews?.set(r ? cuts(r) : [])
  }

  function end(commit: boolean) {
    const d = drag
    drag = null
    if (!d) return
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    if (!d.moved) return
    ctx.pagePreviews?.set([])
    swallowNextContextMenu()
    if (!commit || !d.anchor || !d.focus) return
    const r = rangeBetween(d.anchor, d.focus)
    if (r.collapsed) return
    const cmd = unmarkCommand(ctx.session.store, d.kind, cuts(r))
    if (cmd) ctx.execute(cmd)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 2) return
    const k = kind()
    const t = e.target
    if (!k || !(t instanceof Node) || !inTextLayer(t)) return
    end(false)
    drag = { pointerId: e.pointerId, kind: k, x: e.clientX, y: e.clientY, moved: false, anchor: caretAt(e.clientX, e.clientY), focus: null }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    // Right button released while another is still held: the drag ends here.
    if ((e.buttons & 2) === 0) return end(true)
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_THRESHOLD_PX) return
    drag.moved = true
    const caret = caretAt(e.clientX, e.clientY)
    if (!caret) return
    if (!drag.anchor) drag.anchor = caret
    else drag.focus = caret
    if (frame === null) frame = requestAnimationFrame(preview)
  }

  function onPointerUp(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) end(true)
  }

  function onPointerCancel(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) end(false)
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  return () => {
    end(false)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }
}
