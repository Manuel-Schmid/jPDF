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
   * the next one anywhere for a moment (one guard at a time).
   */
  function guardContextMenu() {
    stopMenuGuard?.()
    const swallow = (e: Event) => {
      e.preventDefault()
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
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { PageViewport } from 'pdfjs-dist'
  import type { PdfDoc } from './pdfEngine'
  import type { PageEntry } from '../session/pages'
  import { blankViewport, entryOf, sourceViewport } from './pageSource'
  import type { AnnotationStore } from '../session/store.svelte'
  import type { Annotation, Point, Rect } from '../session/model'
  import type { PageMenuPoint } from './viewerMath'
  import type { LassoPath, PageFrame, PagePointerEvent, TextEdit, ToolHandler } from '../registry/tools'
  import SelectionBar from './SelectionBar.svelte'
  import { UNMARK_COLOR } from '../../tools/shared/unmark'
  import { cssColor } from '../../annotations/freetext/screen'

  const LASSO_COLOR = cssColor(UNMARK_COLOR)
  const LASSO_FILL_OPACITY = 0.15
  import { annotationKinds } from '../registry/annotationKinds'
  import { pageHasText } from './textContent'
  import { clientToPdf as mapClientToPdf } from './viewerMath'
  import TextEditor from '../../annotations/freetext/Editor.svelte'
  import { handlePoint, handlesFor, toScreenRect } from '../../tools/select/handles'
  import { eraserTool } from '../../tools/eraser'

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
    cursor,
    textEdit = null,
    selection = [],
    viewport,
    onpagemenu,
    frames,
    rescrollMoves = false,
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
  } = $props()

  let loaded = $state<PageViewport | null>(null)
  const vp = $derived(viewport ?? loaded)
  /** Whether the page has selectable text; null until known. */
  let hasText = $state<boolean | null>(null)
  /**
   * A text-selecting tool (marker text mode) on a page that has, or may have,
   * text: pointer input goes through to the text layer underneath.
   */
  const textSelecting = $derived(!!tool?.textSelection?.() && hasText !== false)
  /** A tool that lets input through where nothing of its is under the pointer (select). */
  const hoverPassing = $derived(!!tool?.passThroughAt && hasText !== false)
  /** tool.passThroughAt at the last hover position (see onHover). */
  let passAt = $state(true)
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

  /** Annotation `id` as drawn now: its preview while dragged, nothing while hidden. */
  function drawn(id: string): Annotation | undefined {
    if (preview?.id === id) return preview
    const p = previews.find((x) => x.id === id)
    if (p) return p
    return hidden?.has(id) ? undefined : store.get(id)
  }

  /** Screen box and handles of the selected annotation if it is drawn on this page (its preview while dragged). */
  const selected = $derived.by(() => {
    const id = selection[0]
    if (!vp || id === undefined || tool?.groupSelection) return null
    const a = drawn(id)
    if (!a || a.page !== pageNumber - 1) return null
    return { rect: toScreenRect(annotationKinds.get(a.kind).bounds(a), vp), handles: handlesFor(a) }
  })

  /**
   * Group selection (lasso): the screen boxes of the selected annotations on
   * this page and their common box; `moving` while they are being dragged.
   */
  const group = $derived.by(() => {
    if (!vp || !tool?.groupSelection || selection.length === 0) return null
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
    return { boxes, rect, moving }
  })

  /** The lasso outline as SVG polygon points (viewport px). */
  const lassoPoints = $derived.by(() => {
    if (!vp || !lasso || lasso.page !== pageNumber - 1) return null
    return lasso.points.map((p) => vp!.convertToViewportPoint(p[0], p[1]).join(',')).join(' ')
  })

  let el: SVGSVGElement
  /**
   * Gesture in progress: its pointer, the handler that received its pointerdown,
   * its latest page event (used to cancel when no native event is available)
   * and whether it is a right-button erase (handler = `eraser`, not `tool`).
   */
  let gesture: { pointerId: number; tool: ToolHandler; last: PagePointerEvent; erase: boolean } | null = null
  /** Native event of the gesture's latest move (re-sent after a scroll, see rescrollMoves). */
  let lastMove: PointerEvent | null = null
  /** A right-button erase is in progress: the overlay takes input and shows the eraser cursor. */
  let erasing = $state(false)
  const ERASER_CURSOR = eraserTool.cursor!({})
  /** Elements where a right click keeps its native behaviour (text box editor). */
  const EDITABLE = 'textarea, input, [contenteditable]:not([contenteditable="false"])'

  /** The handler a gesture of this kind belongs to now (it is stale once that changed). */
  const handlerFor = (erase: boolean) => (erase ? eraser : tool)

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
      guardContextMenu()
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
    if (!tool || passThrough || !vp || e.button !== 0 || gesture) return
    const pe = toPageEvent(e, vp)
    gesture = { pointerId: e.pointerId, tool, last: pe, erase: false }
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
    if (e.button !== 2 || !eraser || !vp || gesture) return
    const t = e.target
    if (t instanceof Element && t.closest(EDITABLE)) return
    e.preventDefault()
    e.stopPropagation()
    activeErase?.()
    const pe = toPageEvent(e, vp)
    gesture = { pointerId: e.pointerId, tool: eraser, last: pe, erase: true }
    activeErase = cancelErase
    erasing = true
    try {
      el.setPointerCapture?.(e.pointerId)
    } catch {
      // Pointer already gone; the gesture ends with the next up/cancel.
    }
    eraser.onPointerDown?.(pe)
  }

  /** Cancels this page's right-button erase (another page started one). */
  function cancelErase() {
    if (!gesture?.erase) return
    const { tool: t, last } = gesture
    dropGesture()
    if (t === eraser) t.onPointerCancel?.(last)
  }

  /**
   * No browser context menu over the page, except in the text box editor:
   * a right drag erases, or (tools without the temporary eraser) the page menu opens.
   */
  function onContextMenu(e: MouseEvent) {
    const t = e.target
    if (t instanceof Element && t.closest(EDITABLE)) return
    e.preventDefault()
    if (eraser) return
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
    // Right button released while another is still held: the erase ends here
    // (the pointerup only comes with the last button).
    if (gesture?.erase && (e.buttons & 2) === 0) {
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
    const current = tool // read first: with eraser, this effect's only dependencies
    const currentEraser = eraser
    if (gesture && gesture.tool !== (gesture.erase ? currentEraser : current)) dropGesture()
    passAt = true
  })

  /**
   * Hover pass-through: decides, before a press, whether it goes to the tool
   * or through to the text layer. Listens on the page (the overlay itself gets
   * no events while passing through); only while no button is pressed, so a
   * text selection dragged across an annotation keeps going.
   */
  function onHover(e: PointerEvent) {
    if (!tool?.passThroughAt || !vp || gesture || e.buttons !== 0) return
    passAt = tool.passThroughAt(toPageEvent(e, vp))
  }

  /** A press that went through to the text layer (not to the overlay or a text box editor). */
  function onPagePointerDown(e: PointerEvent) {
    if (!tool?.passThroughAt || !hoverPassing || !passAt || !vp || e.button !== 0) return
    const t = e.target
    if (t instanceof Node && el.contains(t)) return
    if (t instanceof HTMLElement && t.closest('textarea')) return
    const pe = toPageEvent(e, vp)
    tool.onPassThroughDown?.(pe)
    // No hover before the press (touch): the next press goes where this one was.
    passAt = tool.passThroughAt(pe)
  }

  $effect(() => {
    const page = el.parentElement
    if (!page) return
    page.addEventListener('pointermove', onHover)
    page.addEventListener('pointerdown', onPagePointerDown)
    page.addEventListener('pointerdown', onPageRightDown, { capture: true })
    page.addEventListener('contextmenu', onContextMenu)
    return () => {
      page.removeEventListener('pointermove', onHover)
      page.removeEventListener('pointerdown', onPagePointerDown)
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
  class:interactive={(tool && !passThrough) || erasing}
  style:cursor={erasing ? ERASER_CURSOR : tool ? cursor : undefined}
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
  {#if vp}
    {#each annotations as a (a.id)}
      {#if !hidden?.has(a.id)}
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
      {@const r = group.rect}
      <g class="selection" data-testid="group-selection">
        {#if group.boxes.length > 1}
          {#each group.boxes as b, i (i)}
            <rect class="member-box" x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} />
          {/each}
        {/if}
        <rect class="selection-box" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
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
      {@const r = selected.rect}
      <g class="selection">
        <rect class="selection-box" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
        {#each selected.handles as h (h)}
          {@const [hx, hy] = handlePoint(r, h)}
          <rect class="handle" data-handle={h} x={hx - 4} y={hy - 4} width="8" height="8" />
        {/each}
      </g>
    {/if}
  {/if}
</svg>
{#if vp && textEdit}
  <TextEditor edit={textEdit} {vp} />
{/if}
{#if vp && group && !group.moving && !lassoPoints}
  <SelectionBar rect={group.rect} {vp} count={group.boxes.length} />
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
    stroke: var(--accent);
    stroke-width: 1;
  }
  .member-box {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.7;
  }
  .lasso {
    stroke-width: 1;
    stroke-dasharray: 4 3;
    pointer-events: none;
  }
  .handle {
    fill: var(--bg);
    stroke: var(--accent);
    stroke-width: 1;
  }
  .interactive {
    pointer-events: auto;
    /* Pen and touch draw instead of scrolling. */
    touch-action: none;
  }
</style>
