<script lang="ts">
  import { onMount } from 'svelte'
  import type { LassoPath, PageFrame, TextEdit, ToolHandler } from '../registry/tools'
  import type { Annotation } from '../session/model'
  import { firstOccurrences } from '../session/pages'
  import type { DocumentSession } from '../session/session.svelte'
  import { autoScrollArmed, autoScrollSpeed } from './autoScroll'
  import { clampScale, contentWidth, pageLeft, visibleRange } from './layout'
  import Overlay from './Overlay.svelte'
  import PageView from './PageView.svelte'
  import type { SearchView } from './search'
  import SearchHighlights from './SearchHighlights.svelte'
  import { blurAfterPointerClick, isSpacePanBlocked } from './spacePan'
  import { wheelZoomFactor, type PageMenuPoint } from './viewerMath'

  // Mount one Viewer per session ({#key session.id}); scroll and scale live on
  // the session, so switching tabs restores them.
  let {
    session,
    tool = null,
    eraser = null,
    penEraser = null,
    onpagemenu,
    cursor,
    toolPreview = null,
    toolPagePreviews = [],
    toolLasso = null,
    toolHidden,
    toolTextEdit = null,
    toolSelection = [],
    crossDrag = null,
    frames,
    onstyle,
    search = null,
  }: {
    session: DocumentSession
    /** Active tool's handler (see ToolRouter); page overlays forward pointer input to it. */
    tool?: ToolHandler | null
    /** Temporary right-button eraser (see ToolRouter.eraser). */
    eraser?: ToolHandler | null
    /** Eraser for the pen's eraser end (see ToolRouter.penEraser). */
    penEraser?: ToolHandler | null
    /** Right-click without the temporary eraser: open the page menu (page 0-based, client coordinates, the point on the page). */
    onpagemenu?: (page: number, clientX: number, clientY: number, at?: PageMenuPoint) => void
    cursor?: string
    /** The tool's live, uncommitted annotation, drawn on its page. */
    toolPreview?: Annotation | null
    /** The tool's live annotations, any number per page (see ToolContext.pagePreviews). */
    toolPagePreviews?: readonly Annotation[]
    /** The lasso being drawn (see ToolContext.lasso). */
    toolLasso?: LassoPath | null
    /** Annotation ids the active tool has hidden (erased, not yet committed). */
    toolHidden?: ReadonlySet<string>
    /** The tool's open text box editor, drawn on its page. */
    toolTextEdit?: TextEdit | null
    /** Selected annotation ids (outlined by the overlays). */
    toolSelection?: readonly string[]
    /** Cross-page drag in progress: its page stays mounted (see ToolContext.crossDrag). */
    crossDrag?: { page: number; at?: number } | null
    /** Registry the page overlays put their frames in (see SessionToolState.frames). */
    frames?: Map<number, () => PageFrame | null>
    /** Commits a style edit of the selection from the selection bar's Style card (one undo step). */
    onstyle?: (afters: Annotation[]) => void
    /** Search hits to highlight (drawn on the mounted pages only); null = none. */
    search?: SearchView | null
  } = $props()

  const WHEEL_COMMIT_MS = 150

  let el: HTMLDivElement

  // Live Ctrl+wheel / pinch preview: the committed layout is CSS-scaled by
  // preview.scale / session.scale around `origin` (content coordinates) until
  // the gesture pauses and the zoom is committed.
  let preview = $state<{ scale: number; origin: { x: number; y: number } } | null>(null)
  let wheelAnchor = { x: 0, y: 0 }
  let commitTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Text-selecting tools: tint for the native selection in the text layers
   * ('hidden' when the tool previews its result instead).
   */
  const selectionColor = $derived.by(() => {
    const s = tool?.textSelection?.()
    return s ? (s.color ?? 'hidden') : null
  })

  const layout = $derived(session.layout)
  /** pdf.js draws the file's annotations on the first copy of a file page only (see firstOccurrences). */
  const firsts = $derived(firstOccurrences(session.pages))
  const width = $derived(contentWidth(layout, session.viewportW))
  const range = $derived(visibleRange(layout, session.scrollTop, session.viewportH, 1))
  const pages = $derived.by(() => {
    const list = Array.from({ length: Math.max(0, range.last - range.first + 1) }, (_, k) => range.first + k)
    // The page a cross-page drag started on owns the gesture, and the dragged
    // element is drawn on (and placed from) the page it is on: neither may unmount.
    for (const pinned of [crossDrag?.page, crossDrag?.at]) {
      if (pinned !== undefined && pinned < session.pages.length && !list.includes(pinned)) list.push(pinned)
    }
    return list.sort((a, b) => a - b)
  })

  // Cross-page drag: scroll while the pointer is near the top/bottom edge.
  $effect(() => {
    if (!crossDrag) return
    let pointerY: number | null = null
    let startY: number | null = null
    let armed = false
    let frame = 0
    const track = (e: PointerEvent) => {
      pointerY = e.clientY
      startY ??= e.clientY
    }
    const step = () => {
      if (pointerY !== null && startY !== null) {
        const r = el.getBoundingClientRect()
        armed ||= autoScrollArmed(startY, pointerY, r.top, r.bottom)
      }
      if (armed && pointerY !== null) {
        const r = el.getBoundingClientRect()
        const speed = autoScrollSpeed(pointerY, r.top, r.bottom)
        if (speed !== 0) el.scrollTop += speed
      }
      frame = requestAnimationFrame(step)
    }
    window.addEventListener('pointermove', track, true)
    frame = requestAnimationFrame(step)
    return () => {
      window.removeEventListener('pointermove', track, true)
      cancelAnimationFrame(frame)
    }
  })

  function onScroll() {
    session.setScroll(el.scrollTop, el.scrollLeft)
  }

  // Apply programmatic scroll changes (zoom, goToPage, tab restore) to the DOM.
  // Runs after the DOM update, so the content already has its new size.
  $effect(() => {
    const top = session.scrollTop
    const left = session.scrollLeft
    if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top
    if (Math.abs(el.scrollLeft - left) >= 1) el.scrollLeft = left
    // The browser clamps out-of-range positions without always firing a scroll event.
    if (Math.abs(el.scrollTop - top) >= 1 || Math.abs(el.scrollLeft - left) >= 1) {
      session.setScroll(el.scrollTop, el.scrollLeft)
    }
  })

  // Temporary pan: Space held or the middle button, in any tool. Handled in the
  // capture phase on the viewer so the active tool never sees those events.
  let spaceHeld = $state(false)
  let panning = $state(false)
  let panPointer: { id: number; x: number; y: number } | null = null

  function onWindowKeyDown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || isSpacePanBlocked(e.target)) return
    e.preventDefault() // no page scroll
    spaceHeld = true
  }

  function onWindowKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') spaceHeld = false
  }

  function onPanDown(e: PointerEvent) {
    const middle = e.button === 1
    if (panPointer || !(middle || (e.button === 0 && spaceHeld))) return
    e.preventDefault()
    e.stopPropagation()
    panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY }
    panning = true
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // Pointer already gone; the gesture ends with the next up/cancel.
    }
  }

  function onPanMove(e: PointerEvent) {
    if (!panPointer || panPointer.id !== e.pointerId) return
    // The up/cancel was lost: do not keep panning (or blocking new pans).
    if (e.buttons === 0) return endPan(e)
    // Client deltas: page-local coordinates move with the page while panning.
    session.scrollBy(-(e.clientX - panPointer.x), -(e.clientY - panPointer.y))
    panPointer.x = e.clientX
    panPointer.y = e.clientY
  }

  function endPan(e: PointerEvent) {
    if (!panPointer || panPointer.id !== e.pointerId) return
    panPointer = null
    panning = false
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already be gone.
    }
  }

  // WebView2 starts autoscroll on a middle-button mousedown.
  function onPanMouseDown(e: MouseEvent) {
    if (e.button === 1) e.preventDefault()
  }

  function onWheel(e: WheelEvent) {
    // Touchpad pinch arrives as Ctrl+wheel too.
    if (!e.ctrlKey) return
    e.preventDefault()
    if (!preview) {
      const r = el.getBoundingClientRect()
      wheelAnchor = { x: e.clientX - r.left, y: e.clientY - r.top }
      preview = {
        scale: session.scale,
        origin: { x: el.scrollLeft + wheelAnchor.x, y: el.scrollTop + wheelAnchor.y },
      }
    }
    preview.scale = clampScale(preview.scale * wheelZoomFactor(e.deltaY, e.deltaMode))
    clearTimeout(commitTimer)
    commitTimer = setTimeout(commitWheelZoom, WHEEL_COMMIT_MS)
  }

  function commitWheelZoom() {
    clearTimeout(commitTimer)
    if (!preview) return
    const scale = preview.scale
    preview = null
    session.zoomTo(scale, wheelAnchor)
  }

  onMount(() => {
    const measure = () => {
      session.setViewport(el.clientWidth, el.clientHeight)
      // Fit width needs a real viewport; layout may not have settled on mount.
      if (el.clientWidth > 0 && el.clientHeight > 0) session.initView()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Non-passive so preventDefault stops WebView2 from zooming the whole UI.
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPanDown, { capture: true })
    el.addEventListener('pointermove', onPanMove, { capture: true })
    el.addEventListener('pointerup', endPan, { capture: true })
    el.addEventListener('pointercancel', endPan, { capture: true })
    el.addEventListener('mousedown', onPanMouseDown, { capture: true })
    const clearSpace = () => {
      spaceHeld = false
      if (panPointer) endPan({ pointerId: panPointer.id } as PointerEvent)
    }
    el.addEventListener('lostpointercapture', endPan)
    window.addEventListener('click', blurAfterPointerClick)
    window.addEventListener('keydown', onWindowKeyDown)
    window.addEventListener('keyup', onWindowKeyUp)
    window.addEventListener('blur', clearSpace)
    return () => {
      el.removeEventListener('pointerdown', onPanDown, { capture: true })
      el.removeEventListener('pointermove', onPanMove, { capture: true })
      el.removeEventListener('pointerup', endPan, { capture: true })
      el.removeEventListener('pointercancel', endPan, { capture: true })
      el.removeEventListener('mousedown', onPanMouseDown, { capture: true })
      window.removeEventListener('keydown', onWindowKeyDown)
      window.removeEventListener('keyup', onWindowKeyUp)
      window.removeEventListener('blur', clearSpace)
      el.removeEventListener('lostpointercapture', endPan)
      window.removeEventListener('click', blurAfterPointerClick)
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      commitWheelZoom()
    }
  })
</script>

<div
  class="viewer"
  style:cursor={panning ? 'grabbing' : spaceHeld ? 'grab' : undefined}
  bind:this={el}
  onscroll={onScroll}
>
  <div class="content" style:width="{width}px" style:height="{layout.totalHeight}px">
    <div
      class="pages"
      class:previewing={preview}
      style:transform={preview ? `scale(${preview.scale / session.scale})` : undefined}
      style:transform-origin={preview ? `${preview.origin.x}px ${preview.origin.y}px` : undefined}
    >
      {#each pages as i (i)}
        <PageView
          doc={session.doc}
          cacheId={session.id}
          pageNumber={i + 1}
          entry={session.pages[i]}
          annotations={firsts[i]}
          pageSize={session.pageSizes[i]}
          scale={session.scale}
          left={pageLeft(layout, i, session.viewportW)}
          top={layout.tops[i]}
          {selectionColor}
        >
          {@const hits = search?.byPage.get(i)}
          {#if hits}
            <SearchHighlights
              doc={session.doc}
              pageNumber={i + 1}
              entry={session.pages[i]}
              scale={session.scale}
              {hits}
              current={search?.current}
            />
          {/if}
          <Overlay
            doc={session.doc}
            pageNumber={i + 1}
            entry={session.pages[i]}
            scale={session.scale}
            store={session.store}
            preview={toolPreview?.page === i ? toolPreview : null}
            previews={toolPreview?.page === i ? [] : toolPagePreviews.filter((a) => a.page === i)}
            lasso={toolLasso?.page === i ? toolLasso : null}
            hidden={toolHidden}
            textEdit={toolTextEdit?.draft.page === i ? toolTextEdit : null}
            selection={toolSelection}
            {tool}
            {eraser}
            {penEraser}
            {onpagemenu}
            {frames}
            rescrollMoves={!!crossDrag}
            {onstyle}
            cursor={panning ? 'grabbing' : spaceHeld ? 'grab' : cursor}
          />
        </PageView>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewer {
    height: 100%;
    overflow: auto;
    /* Keep clientWidth stable whether or not the vertical scrollbar shows. */
    scrollbar-gutter: stable;
    background: var(--bg);
  }
  .content {
    position: relative;
    /* A CSS-scaled preview must not grow the scrollable area. */
    overflow: clip;
  }
  .pages {
    position: absolute;
    inset: 0;
  }
  .previewing {
    will-change: transform;
  }
</style>
