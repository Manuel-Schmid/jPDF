<script module lang="ts">
  /**
   * Cancels the right-button erase in progress, on whichever page it runs:
   * all pages share one eraser handler, so a stale gesture on one page must
   * not reset or commit another page's erasures.
   */
  let activeErase: (() => void) | null = null
  /** Removes the pending context-menu guard (see guardContextMenu). */
  let stopMenuGuard: (() => void) | null = null

  /**
   * An erase released outside the page: the context menu that follows the
   * right-button release goes to whatever is under the pointer, so swallow
   * the next one anywhere for a moment (one guard at a time). With
   * `fromPage`, it does not reach the page either: after a pen side-button
   * erase with a text-selecting tool (no temporary eraser), which would
   * open its page menu.
   */
  function guardContextMenu(fromPage = false) {
    stopMenuGuard?.()
    const swallow = (e: Event) => {
      e.preventDefault()
      if (fromPage) e.stopPropagation()
      stop()
    }
    const timer = setTimeout(() => stop(), 500)
    function stop() {
      window.removeEventListener('contextmenu', swallow, true)
      clearTimeout(timer)
      if (stopMenuGuard === stop) stopMenuGuard = null
    }
    window.addEventListener('contextmenu', swallow, true)
    stopMenuGuard = stop
  }

  /*
   * Palm rejection: while a pen is in range (hovering or touching), touch
   * input on the page is ignored, so a resting hand neither draws nor erases.
   * The pen counts as in range from any pen event until it leaves the window
   * (pointerout without a related target: out of hover range) or sends no
   * event for PEN_RANGE_MS (a missed out event must not block touch for good).
   */
  const PEN_RANGE_MS = 1000
  let penInRange = false
  let penSeenAt = -Infinity
  const penDown = new Set<number>()
  /** Called when a pen comes in range (pages cancel a touch gesture in progress). */
  const penEnterListeners = new Set<() => void>()
  let penTrackers = 0
  const PEN_EVENTS = ['pointerover', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout'] as const

  /** Whether a pen is in range now (see above). */
  export function penNear(now = performance.now()): boolean {
    return penDown.size > 0 || (penInRange && now - penSeenAt < PEN_RANGE_MS)
  }

  function onPenEvent(e: PointerEvent) {
    if (e.pointerType !== 'pen') return
    if (e.type === 'pointerdown') penDown.add(e.pointerId)
    else if (e.type === 'pointerup' || e.type === 'pointercancel') penDown.delete(e.pointerId)
    if (e.type === 'pointerout' && e.relatedTarget === null) {
      penInRange = false
      penDown.clear()
      return
    }
    const now = performance.now()
    const was = penNear(now)
    penInRange = true
    penSeenAt = now
    if (!was) for (const f of penEnterListeners) f()
  }

  /** Tracks pen range while at least one page or viewer is mounted; returns the stop function. */
  export function trackPen(onEnter: () => void): () => void {
    if (penTrackers++ === 0) for (const t of PEN_EVENTS) window.addEventListener(t, onPenEvent, true)
    penEnterListeners.add(onEnter)
    return () => {
      penEnterListeners.delete(onEnter)
      if (--penTrackers === 0) {
        for (const t of PEN_EVENTS) window.removeEventListener(t, onPenEvent, true)
        penInRange = false
        penDown.clear()
      }
    }
  }

  /** Each mounted page's cancelTouch (see cancelTouchGestures). */
  const touchCancelListeners = new Set<() => void>()

  /**
   * Cancels the touch gesture in progress on any page: a second finger turned
   * it into a pinch (see Viewer), so the first finger's stroke is discarded.
   */
  export function cancelTouchGestures(): void {
    for (const f of touchCancelListeners) f()
  }

  /** Registers a listener called when a touch gesture is cancelled (e.g. a second finger starts a pinch). */
  export function onTouchCancel(fn: () => void): () => void {
    touchCancelListeners.add(fn)
    return () => touchCancelListeners.delete(fn)
  }

  /** Touch input to ignore: a pen is in range (palm rejection). */
  const isPalm = (e: PointerEvent) => e.pointerType === 'touch' && penNear()
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { selectionTint, textLayerFor } from './textLayers'
  import FreeTextLayer from './FreeTextLayer.svelte'
  import { isUpright, selectableBox } from '../../annotations/freetext/selectable'
  import type { PageViewport } from 'pdfjs-dist'
  import type { PdfDoc } from './pdfEngine'
  import type { PageEntry } from '../session/pages'
  import { blankViewport, entryOf, sourceViewport } from './pageSource'
  import type { AnnotationStore } from '../session/store.svelte'
  import type { Annotation, Point, Rect, RGB } from '../session/model'
  import type { PageMenuPoint } from './viewerMath'
  import type { LassoPath, PageFrame, PagePointerEvent, TextEdit, ToolHandler } from '../registry/tools'
  import SelectionBar from './SelectionBar.svelte'
  import { UNMARK_COLOR } from '../../tools/shared/unmark'
  import { DEFAULT_PEN_BUTTONS, penButtonAction, type PenButtonMap } from '../../tools/rightClick'
  import { cssColor } from '../../annotations/freetext/screen'

  const LASSO_COLOR = cssColor(UNMARK_COLOR)
  const LASSO_FILL_OPACITY = 0.15
  /** How near (CSS px) an eyedropper press must be to an annotation to take its colour. */
  const PICK_TOLERANCE_PX = 4
  import { annotationKinds } from '../registry/annotationKinds'
  import { pageHasText } from './textContent'
  import { clientToPdf as mapClientToPdf } from './viewerMath'
  import TextEditor from '../../annotations/freetext/Editor.svelte'
  import {
    frameBounds, frameCentre, grabAt, HANDLE_PILL, HANDLE_PILL_WIDTH, HANDLE_RADIUS, HANDLE_TOLERANCE_PX, handlePoint, handlesFor,
    isCorner, isRotatable, ROTATE_RADIUS, rotateHandlePoint, selectionFrame, toScreenRect, type Grab, type Handle, type ScreenFrame,
  } from '../../tools/select/handles'
  import { eraserTool } from '../../tools/eraser'
  import { lassoTool } from '../../tools/lasso'
  import { layoutFreeText } from '../../tools/text/editing'
  import { normalizeRotation } from '../geometry/textLayout'
  import { isEditable, type FreeTextAnnotation } from '../session/model'
  import { annotationView } from './annotationView.svelte'
  import { annotationColor, canvasColorAt, registerColorSource } from './eyedropper.svelte'
  import { hitAnnotations } from '../geometry/hit'

  let {
    doc,
    pageNumber,
    entry,
    scale,
    store,
    preview = null,
    previews = [],
    lasso = null,
    hidden,
    tool = null,
    eraser = null,
    penEraser = null,
    penLasso = null,
    penGroup = false,
    penButtons = DEFAULT_PEN_BUTTONS,
    ontoolpress,
    cursor,
    textEdit = null,
    selection = [],
    viewport,
    onpagemenu,
    frames,
    rescrollMoves = false,
    onstyle,
    hint = null,
    drawWithFinger = false,
  }: {
    doc?: PdfDoc
    /** 1-based position in the page list; Annotation.page is 0-based. */
    pageNumber: number
    /** What the page shows; default: file page `pageNumber`, unrotated. */
    entry?: PageEntry
    /** CSS scale (not multiplied by devicePixelRatio). */
    scale: number
    store: AnnotationStore
    /** In-progress annotation drawn on top (tool preview). */
    preview?: Annotation | null
    /** More in-progress annotations on this page (e.g. a group being moved), drawn on top. */
    previews?: readonly Annotation[]
    /** The lasso being drawn, when on this page. */
    lasso?: LassoPath | null
    /** Annotation ids not drawn (erased during an uncommitted drag). */
    hidden?: ReadonlySet<string>
    /** Active tool's handler; the overlay takes pointer input only when set. */
    tool?: ToolHandler | null
    /**
     * Temporary eraser: a right-button drag anywhere on the page goes to it
     * (also while the overlay passes input through, or without a tool).
     */
    eraser?: ToolHandler | null
    /**
     * Eraser for the pen's eraser end: a drag with it anywhere on the page
     * goes to it, whatever the tool (see ToolRouter.penEraser).
     */
    penEraser?: ToolHandler | null
    /**
     * Lasso for a pen button mapped to it: a drag with that button held goes
     * to it, whatever the tool (see ToolRouter.penLasso).
     */
    penLasso?: ToolHandler | null
    /** The selection is the pen lasso's: shown as a group whatever the tool (see ToolRouter.penGroup). */
    penGroup?: boolean
    /** What each pen button does (Settings → Toolbar → Pen buttons). */
    penButtons?: PenButtonMap
    /** A press goes to the active tool (it drops the pen lasso's selection, see ToolRouter.dropPenSelection). */
    ontoolpress?: () => void
    /** CSS cursor while a tool is active. */
    cursor?: string
    /**
     * Open text box editor on this page: a <textarea> stacked above the SVG
     * (a sibling, so its pointer input never reaches the tool).
     */
    textEdit?: TextEdit | null
    /** Selected annotation ids: outlined (with resize handles) when on this page. */
    selection?: readonly string[]
    /** Overrides the viewport derived from doc (tests). */
    viewport?: PageViewport
    /**
     * Right-click without the temporary eraser (select, lasso, text marker):
     * open the page menu for this page (0-based) at client coordinates.
     */
    onpagemenu?: (page: number, clientX: number, clientY: number, at?: PageMenuPoint) => void
    /** Registry of mounted pages' frames (see SessionToolState.frames): this page registers itself. */
    frames?: Map<number, () => PageFrame | null>
    /**
     * While a gesture runs, re-send its last pointer position as a move after
     * every scroll (auto-scroll during a cross-page drag moves the page, not the pointer).
     */
    rescrollMoves?: boolean
    /** Commits a style edit of the selection from its Style card (one undo step); no Style button without it. */
    onstyle?: (afters: Annotation[]) => void
    /** Tooltip while the pointer is over the overlay (a link's address); null = none. */
    hint?: string | null
    /** Whether one finger on a touchscreen draws with the active tool instead of scrolling. */
    drawWithFinger?: boolean
  } = $props()

  /** Touch input to ignore: finger drawing is off, or a pen is in range (palm rejection). */
  const ignoreTouch = (e: PointerEvent) => e.pointerType === 'touch' && (!drawWithFinger || penNear())

  let loaded = $state<PageViewport | null>(null)
  const vp = $derived(viewport ?? loaded)
  /** Whether the page has selectable text; null until known. */
  let hasText = $state<boolean | null>(null)
  /**
   * A text-selecting tool (underline, strike-out) on a page that has, or may
   * have, text: pointer input goes through to the text layer underneath. A
   * tool that also has passThroughAt (marker text mode) lets it through only
   * where that says so (hoverPassing).
   */
  const textSelecting = $derived(!!tool?.textSelection?.() && !tool?.passThroughAt && hasText !== false)
  /** A tool that lets input through where nothing of its is under the pointer (select). */
  const hoverPassing = $derived(!!tool?.passThroughAt && hasText !== false)
  /** The last right press was left to the text layer (unmark), not erased: its context menu may open. */
  let rightToText = false
  /** tool.passThroughAt at the last hover position (see onHover). */
  let passAt = $state(true)
  /** The resize or rotate handle under the pointer (drawn larger); kept while it is dragged. */
  let hoverHandle = $state<Grab | null>(null)
  const passThrough = $derived(textSelecting || (hoverPassing && passAt))

  $effect(() => {
    if (viewport) return
    const s = scale
    const shows = entryOf(pageNumber, entry)
    // An empty page: no pdf.js page and no text (the marker draws freehand).
    if (shows.kind === 'blank') {
      loaded = blankViewport(shows.width, shows.height, s, shows.rotate)
      hasText = false
      return
    }
    if (!doc) return
    let cancelled = false
    doc
      .getPage(shows.source + 1)
      .then(async (page) => {
        // The page's own rotation plus the page list's extra rotation.
        if (!cancelled) loaded = sourceViewport(page, shows, s)
        // Unreadable text content: treat as a page without text (freehand fallback).
        const text = await pageHasText(page).catch(() => false)
        if (!cancelled) hasText = text
      })
      .catch((e: unknown) => {
        // Cancelled loads and loads of a closed tab's doc reject by design.
        if (!cancelled && !doc.destroyed) console.error(`Failed to load page ${pageNumber}`, e)
      })
    return () => {
      cancelled = true
    }
  })

  /**
   * The page's annotations in drawing order: flattened ones first, as they
   * will be part of the page content (under every annotation) once saved.
   */
  const annotations = $derived.by(() => {
    const all = store.byPage(pageNumber - 1)
    return all.some((a) => a.flattened) ? [...all.filter((a) => a.flattened), ...all.filter((a) => !a.flattened)] : all
  })

  /**
   * The selection as styled while a Style card control is dragged (by id);
   * drawn instead of the stored annotations until the preview is over.
   */
  let styleLive = $state.raw<ReadonlyMap<string, Annotation> | null>(null)

  /** Annotation `id` as drawn now: its preview while dragged, nothing while hidden. */
  function drawn(id: string): Annotation | undefined {
    if (preview?.id === id) return preview
    const live = styleLive?.get(id)
    if (live) return live
    const p = previews.find((x) => x.id === id)
    if (p) return p
    return hidden?.has(id) ? undefined : store.get(id)
  }

  /** The selection may hold several annotations: the tool's own (lasso) or the pen lasso's (see ToolHandler.groupSelection). */
  const groupMode = $derived(!!tool?.groupSelection || penGroup)

  /** The tool's selection box while it is rotated, if on this page (see ToolHandler.rotatingFrame). */
  const rotating = $derived.by((): ScreenFrame | null => {
    const f = tool?.rotatingFrame?.() ?? penLasso?.rotatingFrame?.()
    if (!vp || !f || f.page !== pageNumber - 1) return null
    return { rect: toScreenRect(f.rect, vp), angle: f.angle }
  })

  /**
   * The selected annotation if it is drawn on this page (its preview while
   * dragged): its selection box on screen (`frame`, turned with it), the
   * box's screen bounds (`rect`), its resize handles and whether it has the
   * rotate handle.
   */
  const selected = $derived.by(() => {
    const id = selection[0]
    if (!vp || id === undefined || groupMode) return null
    const a = drawn(id)
    if (!a || a.page !== pageNumber - 1) return null
    const frame = rotating ?? selectionFrame(a, vp)
    return { frame, rect: frameBounds(frame), handles: handlesFor(a), rotatable: isRotatable(a) }
  })

  /**
   * Group selection (lasso): the screen boxes of the selected annotations on
   * this page and their common box; `moving` while they are being dragged.
   */
  const group = $derived.by(() => {
    if (!vp || !groupMode || selection.length === 0) return null
    const boxes = selection.flatMap((id) => {
      const a = drawn(id)
      return a && a.page === pageNumber - 1 ? [toScreenRect(annotationKinds.get(a.kind).bounds(a), vp!)] : []
    })
    if (boxes.length === 0) return null
    const rect: Rect = [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ]
    const moving = selection.some((id) => hidden?.has(id))
    // Rotatable as a whole when every member is (text markup is not).
    const rotatable = selection.every((id) => {
      const a = store.get(id)
      return !a || a.page !== pageNumber - 1 || isRotatable(a)
    })
    const frame: ScreenFrame = rotating ?? { rect, angle: 0 }
    return { boxes, rect, moving, rotatable, frame }
  })

  /** The lasso outline as SVG polygon points (viewport px). */
  const lassoPoints = $derived.by(() => {
    if (!vp || !lasso || lasso.page !== pageNumber - 1) return null
    return lasso.points.map((p) => vp!.convertToViewportPoint(p[0], p[1]).join(',')).join(' ')
  })

  /**
   * The selection bar (actions and Style) next to the selection on this page:
   * the group's box, or the single selected annotation's while it is not being
   * moved, resized or edited as text. Its annotations are the selected ones on
   * this page as stored (not as previewed).
   */
  const bar = $derived.by(() => {
    if (!vp || textEdit) return null
    let rect: Rect
    if (group) {
      if (group.moving || lassoPoints) return null
      rect = group.rect
    } else if (selected) {
      const id = selection[0]
      if (preview?.id === id || hidden?.has(id) || previews.some((p) => p.id === id)) return null
      rect = selected.rect
    } else {
      return null
    }
    const list = selection.flatMap((id) => {
      const a = store.get(id)
      return a && a.page === pageNumber - 1 && isEditable(a) ? [a] : []
    })
    return list.length > 0 ? { rect, annotations: list } : null
  })

  /**
   * Text-selecting tools (marker text mode, underline, strike-out): the
   * upright text boxes on this page whose text they can mark (see
   * FreeTextLayer), as drawn now; empty for other tools, which never mount
   * that layer.
   */
  const markable = $derived.by(() => {
    if (!vp || !tool?.textSelection?.()) return []
    const editing = textEdit?.draft.id
    return annotations.flatMap((stored) => {
      const a = drawn(stored.id)
      return a?.kind === 'freetext' && a.id !== editing && isUpright(a) && a.lines.length > 0 ? [selectableBox(a, vp!)] : []
    })
  })
  /** The native selection's colour in the text boxes, as in the page's text layer (see Viewer). */
  const boxTint = $derived.by(() => {
    const t = tool?.textSelection?.()
    return t ? selectionTint(t.color ?? 'hidden') : undefined
  })

  function setStyleLive(list: Annotation[] | null) {
    styleLive = list && new Map(list.map((a) => [a.id, a]))
  }

  /** Lays out a text box restyled in the Style card (e.g. its font size dragged) as its page shows it. */
  const relayoutBox = (a: FreeTextAnnotation) => layoutFreeText(a, a.text, normalizeRotation(vp?.rotation))

  let el: SVGSVGElement
  /**
   * A button gesture's kind: right button (handler `eraser`); a pen button
   * that erases, the eraser end ('pen') or the side button ('penSide'), both
   * `penEraser`; a pen button that lassoes ('lasso', 'lassoSide': `penLasso`);
   * or none (`tool`). See penButtonAction for which pen button does what.
   */
  type Erase = false | 'right' | 'pen' | 'penSide' | 'lasso' | 'lassoSide'
  /** Gestures that end when button 2 is let go and are followed by a context menu. */
  const buttonTwo = (erase: Erase) => erase === 'right' || erase === 'penSide' || erase === 'lassoSide'
  const isLasso = (erase: Erase) => erase === 'lasso' || erase === 'lassoSide'
  /** The gesture kind a press starts (see Erase), false, or 'none' for a pen button that does nothing. */
  function eraseKind(e: PointerEvent): Erase | 'none' {
    const pen = penButtonAction(e, !!tool?.textSelection?.(), penButtons)
    if (pen?.action === 'none') return 'none'
    if (pen?.action === 'lasso') return pen.button === 'side' ? 'lassoSide' : 'lasso'
    if (pen) return pen.button === 'side' ? 'penSide' : 'pen'
    return e.button === 2 ? 'right' : false
  }
  /**
   * Gesture in progress: its pointer and pointer type, the handler that
   * received its pointerdown, its latest page event (used to cancel when no
   * native event is available) and whether it is an erase (see Erase).
   */
  let gesture: { pointerId: number; pointerType: string; tool: ToolHandler; last: PagePointerEvent; erase: Erase } | null = null
  /** Native event of the gesture's latest move (re-sent after a scroll, see rescrollMoves). */
  let lastMove: PointerEvent | null = null
  /** A button gesture is in progress (see Erase): the overlay takes input and shows the eraser's (or lasso's) cursor. */
  let erasing = $state<Erase>(false)
  const ERASER_CURSOR = eraserTool.cursor!(eraserTool.defaultSettings)
  const LASSO_CURSOR = lassoTool.cursor!({})
  /** Elements where a right click keeps its native behaviour (text box editor). */
  const EDITABLE = 'textarea, input, [contenteditable]:not([contenteditable="false"])'
  /**
   * Controls drawn on the page (the selection bar): pointer input there is
   * theirs, never the page's (no text pass-through, erasing or page menu).
   * The page listens with native listeners, which a control's own Svelte
   * handlers cannot stop: Svelte 5 delegates those to the app root, so the
   * event has passed the page before they run.
   */
  const PAGE_UI = '[data-page-ui]'
  const onPageUi = (e: Event) => e.target instanceof Element && e.target.closest(PAGE_UI) !== null

  /** The handler a gesture of this kind belongs to now (it is stale once that changed). */
  const handlerFor = (erase: Erase) =>
    erase === 'pen' || erase === 'penSide' ? penEraser : isLasso(erase) ? penLasso : erase ? eraser : tool

  /** Client coordinates → PDF user space. */
  function clientToPdf(clientX: number, clientY: number, v: PageViewport): Point {
    return mapClientToPdf(clientX, clientY, el.getBoundingClientRect(), v)
  }

  function toPageEvent(e: PointerEvent, v: PageViewport): PagePointerEvent {
    const r = el.getBoundingClientRect()
    return {
      page: pageNumber - 1,
      pdf: clientToPdf(e.clientX, e.clientY, v),
      screen: [e.clientX - r.left, e.clientY - r.top],
      vp: v,
      native: e,
      toPdf: (clientX, clientY) => clientToPdf(clientX, clientY, v),
    }
  }

  /** Forgets the gesture and releases its pointer capture. */
  function dropGesture() {
    if (!gesture) return
    const id = gesture.pointerId
    if (gesture.erase) {
      if (buttonTwo(gesture.erase)) guardContextMenu(gesture.erase !== 'right')
      if (activeErase === cancelErase) activeErase = null
    }
    gesture = null
    lastMove = null
    erasing = false
    try {
      if (el?.hasPointerCapture?.(id)) el.releasePointerCapture(id)
    } catch {
      // Capture may already be gone (element detached).
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (!tool || passThrough || !vp || e.button !== 0 || gesture || ignoreTouch(e)) return
    ontoolpress?.()
    const pe = toPageEvent(e, vp)
    gesture = { pointerId: e.pointerId, pointerType: e.pointerType, tool, last: pe, erase: false }
    el.setPointerCapture?.(e.pointerId)
    tool.onPointerDown?.(pe)
  }

  /**
   * Right-button press anywhere on the page (capture phase, so it works while
   * the overlay passes input through): starts a temporary erase. Its default
   * is prevented (no native text selection) and it does not reach the text
   * layer or the tool. A press while another gesture runs never gets here as
   * pointerdown (Chromium reports chorded buttons as pointermove).
   */
  function onPageRightDown(e: PointerEvent) {
    // The pen's buttons work the same way, with the pen eraser or the pen
    // lasso (any tool), as Settings maps them (see Erase).
    const found = eraseKind(e)
    rightToText = false
    const t = e.target
    if (found === 'none') {
      // A pen button that does nothing: no press at all, and no context menu.
      if (onPageUi(e) || (t instanceof Element && t.closest(EDITABLE))) return
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 2) guardContextMenu(true)
      return
    }
    const kind = found
    const handler = handlerFor(kind)
    if (!kind || !handler || !vp || gesture || onPageUi(e)) return
    if (t instanceof Element && t.closest(EDITABLE)) return
    // A text-selecting tool that also erases (marker SmartMark): a right press
    // that went through to the text unmarks it instead (tools/shared/unmark.ts),
    // and a right-click there without a drag still opens the page menu.
    if (kind === 'right' && tool?.textSelection?.() && t instanceof Node && textLayerFor(t)?.[0].contains(t)) {
      rightToText = true
      return
    }
    e.preventDefault()
    e.stopPropagation()
    activeErase?.()
    const pe = toPageEvent(e, vp)
    gesture = { pointerId: e.pointerId, pointerType: e.pointerType, tool: handler, last: pe, erase: kind }
    activeErase = cancelErase
    erasing = kind
    try {
      el.setPointerCapture?.(e.pointerId)
    } catch {
      // Pointer already gone; the gesture ends with the next up/cancel.
    }
    handler.onPointerDown?.(pe)
  }

  /**
   * Annotation view states on a press anywhere on the page (capture phase,
   * before every other listener). Memory mode: a left press on a covered
   * highlight reveals it and goes nowhere else (no stroke, no text
   * selection). Annotations hidden: a press that starts a tool's or an
   * eraser's gesture shows them again first, so nothing is drawn or erased
   * blind.
   */
  function onAnnotationViewDown(e: PointerEvent) {
    if (onPageUi(e) || isPalm(e)) return
    const found = eraseKind(e)
    if (found === 'none') return
    const kind = found
    const covered = coveredAt(e)
    if (e.button === 0 && !kind && covered && el.contains(covered)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      annotationView.reveal(covered.getAttribute('data-reveal')!)
      return
    }
    if (!annotationView.hidden || ignoreTouch(e)) return
    const handler = kind ? handlerFor(kind) : e.button === 0 ? tool : null
    if (handler) annotationView.show()
  }

  /**
   * The covered highlight (memory mode) under a press: its target, or, for a
   * press on a text box's selectable text (stacked above the overlay), the
   * highlight under it there.
   */
  function coveredAt(e: PointerEvent): Element | null {
    const t = e.target
    if (!(t instanceof Element)) return null
    if (!t.closest('.free-text-layer')) return t.closest('[data-reveal]')
    const under = document.elementsFromPoint?.(e.clientX, e.clientY) ?? []
    for (const u of under) {
      const c = u.closest('[data-reveal]')
      if (c && el.contains(c)) return c
    }
    return null
  }

  /** Cancels this page's right-button erase (another page started one). */
  function cancelErase() {
    if (!gesture?.erase) return
    const { tool: t, last, erase } = gesture
    dropGesture()
    if (t === handlerFor(erase)) t.onPointerCancel?.(last)
  }

  /** A touch gesture to discard: a pen came in range (a palm that landed first), or a pinch started. */
  function cancelTouch() {
    if (gesture?.pointerType !== 'touch') return
    const { tool: t, last, erase } = gesture
    dropGesture()
    if (t === handlerFor(erase)) t.onPointerCancel?.(last)
  }

  $effect(() => trackPen(cancelTouch))
  $effect(() => {
    touchCancelListeners.add(cancelTouch)
    return () => touchCancelListeners.delete(cancelTouch)
  })

  /**
   * No browser context menu over the page, except in the text box editor:
   * a right drag erases, or (tools without the temporary eraser) the page menu opens.
   */
  function onContextMenu(e: MouseEvent) {
    const t = e.target
    if (t instanceof Element && t.closest(EDITABLE)) return
    e.preventDefault()
    const toText = rightToText
    rightToText = false
    if ((eraser && !toText) || onPageUi(e)) return
    if (!vp) return onpagemenu?.(pageNumber - 1, e.clientX, e.clientY)
    // The tool first: it may select what was right-clicked for the menu.
    const onSelection = tool?.onContextMenu?.(toPageEvent(e as PointerEvent, vp)) ?? false
    onpagemenu?.(pageNumber - 1, e.clientX, e.clientY, { pdf: clientToPdf(e.clientX, e.clientY, vp), vp, onSelection })
  }

  /** The gesture's handler and page event for `e`, if `e` belongs to the gesture. */
  function forGesture(e: PointerEvent): { t: ToolHandler; pe: PagePointerEvent } | null {
    if (!gesture || gesture.pointerId !== e.pointerId || !vp) return null
    if (gesture.tool !== handlerFor(gesture.erase)) {
      dropGesture()
      return null
    }
    const pe = toPageEvent(e, vp)
    gesture.last = pe
    return { t: gesture.tool, pe }
  }

  function onPointerMove(e: PointerEvent) {
    if (!gesture) {
      if (tool?.onHover && vp && e.buttons === 0) tool.onHover(toPageEvent(e, vp))
      return
    }
    const g = forGesture(e)
    if (!g) return
    lastMove = e
    // Right (or pen side) button released while another is still held: the
    // erase ends here (the pointerup only comes with the last button).
    if (gesture && buttonTwo(gesture.erase) && (e.buttons & 2) === 0) {
      dropGesture()
      g.t.onPointerUp?.(g.pe)
      return
    }
    g.t.onPointerMove?.(g.pe)
  }

  function onPointerUp(e: PointerEvent) {
    const g = forGesture(e)
    if (!g) return
    dropGesture()
    g.t.onPointerUp?.(g.pe)
  }

  /** pointercancel, or capture lost without a preceding pointerup (up clears the gesture first). */
  function onPointerCancel(e: PointerEvent) {
    const g = forGesture(e)
    if (!g) return
    dropGesture()
    g.t.onPointerCancel?.(g.pe)
  }

  // A tool switch mid-stroke: the old handler is deactivated by the router;
  // drop the gesture at once so it cannot block the next press.
  $effect(() => {
    // Read first: with the erasers and the pen lasso, this effect's only dependencies.
    void [tool, eraser, penEraser, penLasso]
    if (gesture && gesture.tool !== handlerFor(gesture.erase)) dropGesture()
    // A text-selecting tool routed by hover (marker SmartMark) takes presses
    // until a hover says otherwise: a touch or a click without moving goes to
    // the tool, which re-checks for text itself. Others pass until then.
    passAt = !untrack(() => tool?.textSelection?.())
  })

  /**
   * Hover pass-through: decides, before a press, whether it goes to the tool
   * or through to the text layer. Listens on the page (the overlay itself gets
   * no events while passing through); only while no button is pressed, so a
   * text selection dragged across an annotation keeps going.
   */
  function onHover(e: PointerEvent) {
    // While dragging, the grabbed handle stays enlarged.
    if (gesture) return
    // Over the bar: nothing of the page is under the pointer.
    if (onPageUi(e)) {
      hoverHandle = null
      return
    }
    hoverHandle = vp && e.buttons === 0 ? handleUnder(toPageEvent(e, vp).screen) : null
    if (!tool?.passThroughAt || !vp || e.buttons !== 0) return
    passAt = tool.passThroughAt(toPageEvent(e, vp))
  }

  /** The selection's resize or rotate handle at `p` (viewport px), if any. */
  function handleUnder(p: Point): Grab | null {
    if (selected) return grabAt(selected.frame, p, HANDLE_TOLERANCE_PX, selected.handles, selected.rotatable, HANDLE_PILL)
    if (group?.rotatable) return grabAt(group.frame, p, HANDLE_TOLERANCE_PX, [], true)
    return null
  }

  function onPageLeave() {
    if (!gesture) hoverHandle = null
  }

  /** A press that went through to the text layer (not to the overlay or a text box editor). */
  function onPagePointerDown(e: PointerEvent) {
    if (!tool?.passThroughAt || !hoverPassing || !passAt || !vp || e.button !== 0 || onPageUi(e) || ignoreTouch(e)) return
    const t = e.target
    if (t instanceof Node && el.contains(t)) return
    if (t instanceof HTMLElement && t.closest('textarea')) return
    ontoolpress?.()
    const pe = toPageEvent(e, vp)
    tool.onPassThroughDown?.(pe)
    // No hover before the press (touch): the next press goes where this one was.
    passAt = tool.passThroughAt(pe)
  }

  $effect(() => {
    const page = el.parentElement
    if (!page) return
    page.addEventListener('pointermove', onHover)
    page.addEventListener('pointerleave', onPageLeave)
    page.addEventListener('pointerdown', onPagePointerDown)
    // First: a reveal takes the press from every other listener.
    page.addEventListener('pointerdown', onAnnotationViewDown, { capture: true })
    page.addEventListener('pointerdown', onPageRightDown, { capture: true })
    page.addEventListener('contextmenu', onContextMenu)
    return () => {
      page.removeEventListener('pointermove', onHover)
      page.removeEventListener('pointerleave', onPageLeave)
      page.removeEventListener('pointerdown', onPagePointerDown)
      page.removeEventListener('pointerdown', onAnnotationViewDown, { capture: true })
      page.removeEventListener('pointerdown', onPageRightDown, { capture: true })
      page.removeEventListener('contextmenu', onContextMenu)
    }
  })

  /** A scroll during the gesture: the pointer now sits elsewhere on the page. */
  function onScrollDuringGesture() {
    if (!gesture || gesture.erase || !lastMove || !vp) return
    if (gesture.tool !== handlerFor(false)) return
    const pe = toPageEvent(lastMove, vp)
    gesture.last = pe
    gesture.tool.onPointerMove?.(pe)
  }

  $effect(() => {
    if (!rescrollMoves) return
    window.addEventListener('scroll', onScrollDuringGesture, true)
    return () => window.removeEventListener('scroll', onScrollDuringGesture, true)
  })

  /** This page's viewport and client origin, for tools that move things between pages. */
  function frame(): PageFrame | null {
    if (!vp || !el) return null
    const r = el.getBoundingClientRect()
    return { vp, origin: [r.left, r.top] }
  }

  $effect(() => {
    const registry = frames
    const page = pageNumber - 1
    if (!registry) return
    registry.set(page, frame)
    return () => {
      if (registry.get(page) === frame) registry.delete(page)
    }
  })

  /**
   * The colour under a pick (eyedropper): the topmost drawn annotation's
   * stored colour, else the rendered page pixel, else the paper (an empty
   * page has no canvas).
   */
  function colorAt(clientX: number, clientY: number): RGB | null {
    if (!vp) return null
    if (!annotationView.hidden) {
      const p = clientToPdf(clientX, clientY, vp)
      const drawnHere = annotations.filter((a) => !hidden?.has(a.id))
      for (const a of hitAnnotations(drawnHere, p, PICK_TOLERANCE_PX / scale)) {
        const c = annotationColor(a)
        if (c) return c
      }
    }
    const canvas = el.parentElement?.querySelector<HTMLCanvasElement>(':scope > canvas')
    return canvas ? canvasColorAt(canvas, clientX, clientY) : [1, 1, 1]
  }

  $effect(() => registerColorSource(el, colorAt))

  // Unmounted mid-stroke (page virtualised away, tab closed): cancel the stroke.
  onDestroy(() => {
    if (!gesture) return
    const { tool: t, last, erase } = gesture
    dropGesture()
    if (t === handlerFor(erase)) t.onPointerCancel?.(last)
  })
</script>

<!-- Same CSS box as the canvas, so it scales with it during the zoom preview. -->
<!-- viewBox = the viewport's own size, so a stale viewport (scale just changed,
     page not yet reloaded) still scales with the resized box. -->
<svg
  bind:this={el}
  class="overlay"
  class:interactive={(tool && !passThrough) || !!erasing}
  class:annotations-hidden={annotationView.hidden}
  style:cursor={erasing ? (isLasso(erasing) ? LASSO_CURSOR : ERASER_CURSOR) : tool ? cursor : undefined}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onlostpointercapture={onPointerCancel}
  role="presentation"
  width="100%"
  height="100%"
  viewBox={vp ? `0 0 ${vp.width} ${vp.height}` : undefined}
  preserveAspectRatio="none"
>
  {#if hint}<title>{hint}</title>{/if}
  {#if vp}
    {#each annotations as stored (stored.id)}
      {#if !hidden?.has(stored.id)}
        {@const a = styleLive?.get(stored.id) ?? stored}
        {@const K = annotationKinds.get(a.kind)}
        <K.Render {a} {vp} selected={false} />
      {/if}
    {/each}
    {#if preview}
      {@const K = annotationKinds.get(preview.kind)}
      <K.Render a={preview} {vp} selected={false} />
    {/if}
    {#each previews as p (p.id)}
      {@const K = annotationKinds.get(p.kind)}
      <K.Render a={p} {vp} selected={false} />
    {/each}
    {#if group}
      {@const r = group.frame.rect}
      {@const [cx, cy] = frameCentre(group.frame)}
      <g class="selection" data-testid="group-selection">
        {#if group.boxes.length > 1}
          {#each group.boxes as b, i (i)}
            <rect class="member-box" x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} />
          {/each}
        {/if}
        <g transform={group.frame.angle ? `rotate(${-group.frame.angle} ${cx} ${cy})` : undefined}>
          <rect class="selection-box" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
          {#if group.rotatable && !group.moving}
            {@render rotateHandle(group.frame)}
          {/if}
        </g>
      </g>
    {/if}
    {#if lassoPoints}
      <!-- The same blue as the tint of text being unmarked: a selection gesture, not a mark. -->
      <polygon
        class="lasso"
        data-testid="lasso"
        points={lassoPoints}
        fill={LASSO_COLOR}
        fill-opacity={LASSO_FILL_OPACITY}
        stroke={LASSO_COLOR}
      />
    {/if}
    {#if selected}
      {@const r = selected.frame.rect}
      {@const [cx, cy] = frameCentre(selected.frame)}
      <!-- Drawn in the box's own frame, turned with it. -->
      <g class="selection" transform={selected.frame.angle ? `rotate(${-selected.frame.angle} ${cx} ${cy})` : undefined}>
        <rect class="selection-box" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
        {#if selected.rotatable}
          {@render rotateHandle(selected.frame)}
        {/if}
        {#each selected.handles as h (h)}
          {@const [hx, hy] = handlePoint(r, h)}
          {#if isCorner(h)}
            <circle class="handle" class:hover={hoverHandle === h} data-handle={h} cx={hx} cy={hy} r={HANDLE_RADIUS} />
          {:else}
            <!-- A pill lying along its edge. -->
            {@const along = h === 'n' || h === 's'}
            {@const w = along ? HANDLE_PILL : HANDLE_PILL_WIDTH}
            {@const ht = along ? HANDLE_PILL_WIDTH : HANDLE_PILL}
            <rect
              class="handle"
              class:hover={hoverHandle === h}
              data-handle={h}
              x={hx - w / 2}
              y={hy - ht / 2}
              width={w}
              height={ht}
              rx={HANDLE_PILL_WIDTH / 2}
            />
          {/if}
        {/each}
      </g>
    {/if}
  {/if}
</svg>
{#snippet rotateHandle(f: ScreenFrame)}
  <!-- A circle on a stem from the middle of the bottom (or top) edge, away from the selection bar. -->
  {@const { at: [hx, hy], from: [, ey] } = rotateHandlePoint(f)}
  <line class="rotate-stem" x1={hx} y1={ey} x2={hx} y2={hy + (hy > ey ? -ROTATE_RADIUS : ROTATE_RADIUS)} />
  <circle class="handle" class:hover={hoverHandle === 'rotate'} data-handle="rotate" cx={hx} cy={hy} r={ROTATE_RADIUS} />
{/snippet}
{#if vp && markable.length > 0}
  <FreeTextLayer page={pageNumber - 1} {vp} boxes={markable} tint={boxTint} />
{/if}
{#if vp && textEdit}
  <TextEditor edit={textEdit} {vp} />
{/if}
{#if vp && bar && !annotationView.hidden}
  <SelectionBar
    rect={bar.rect}
    {vp}
    annotations={bar.annotations}
    {onstyle}
    onlive={setStyleLive}
    relayout={relayoutBox}
  />
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* Click-through unless a tool takes pointer input. */
    pointer-events: none;
  }
  .selection {
    pointer-events: none;
  }
  .selection-box {
    fill: none;
    stroke: var(--page-accent);
    stroke-width: 1.5;
  }
  .rotate-stem {
    stroke: var(--page-accent);
    stroke-width: 1.5;
  }
  .member-box {
    fill: none;
    stroke: var(--page-accent);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.7;
  }
  .lasso {
    stroke-width: 1;
    stroke-dasharray: 4 3;
    pointer-events: none;
  }
  /* White with a blue outline: visible on light pages and on dark drawings. */
  .handle {
    fill: var(--page-handle-fill);
    stroke: var(--page-accent);
    stroke-width: 1.5;
    transform-box: fill-box;
    transform-origin: center;
    transition:
      transform 120ms ease-out,
      stroke var(--transition);
  }
  .handle.hover {
    transform: scale(1.4);
    stroke: var(--page-accent-hover);
  }
  @media (prefers-reduced-motion: reduce) {
    .handle {
      transition: none;
    }
  }
  /*
   * Annotations hidden (H): nothing drawn, without re-rendering them. The
   * overlay itself still takes a tool's press, which shows them again.
   */
  .annotations-hidden > :global(*) {
    display: none;
  }
  .interactive {
    pointer-events: auto;
    /* Pen and touch draw instead of scrolling. */
    touch-action: none;
  }
</style>
