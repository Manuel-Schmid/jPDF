<script lang="ts">
  import { onMount } from 'svelte'
  import type { LassoPath, PageFrame, TextEdit, ToolHandler } from '../registry/tools'
  import type { Annotation } from '../session/model'
  import { firstOccurrences } from '../session/pages'
  import type { DocumentSession } from '../session/session.svelte'
  import { autoScrollArmed, autoScrollSpeed } from './autoScroll'
  import ExplanationField from './ExplanationField.svelte'
  import { FIELD_GAP, fieldBox } from './explanationLayout'
  import { clampScale, contentWidth, pageLeft, PAGE_GAP, visibleRange } from './layout'
  import Overlay, { cancelTouchGestures, penNear, trackPen } from './Overlay.svelte'
  import PageView from './PageView.svelte'
  import type { SearchView } from './search'
  import SearchHighlights from './SearchHighlights.svelte'
  import { blurAfterPointerClick, isSpacePanBlocked } from './spacePan'
  import { wheelZoomFactor, type PageMenuPoint } from './viewerMath'
  import { ctrlWheelAction, trackCtrlKey } from './ctrlKey'
  import { pinchState, startPinch, type Pinch } from './touchPinch'
  import { settings } from '../settings/settings.svelte'
  import { fieldAi } from '../../ai/pageRegeneration'

  // Mount one Viewer per session ({#key session.id}); scroll and scale live on
  // the session, so switching tabs restores them.
  let {
    session,
    tool = null,
    eraser = null,
    penEraser = null,
    penLasso = null,
    penGroup = false,
    ontoolpress,
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
    toolHint = null,
  }: {
    session: DocumentSession
    /** Active tool's handler (see ToolRouter); page overlays forward pointer input to it. */
    tool?: ToolHandler | null
    /** Temporary right-button eraser (see ToolRouter.eraser). */
    eraser?: ToolHandler | null
    /** Eraser for the pen's eraser end (see ToolRouter.penEraser). */
    penEraser?: ToolHandler | null
    /** Lasso for a pen button mapped to it (see ToolRouter.penLasso). */
    penLasso?: ToolHandler | null
    /** The selection is the pen lasso's (see ToolRouter.penGroup). */
    penGroup?: boolean
    /** A press goes to the active tool (see ToolRouter.dropPenSelection). */
    ontoolpress?: () => void
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
    /** Tooltip of the active tool on a page (see ToolContext.hint). */
    toolHint?: { page: number; text: string } | null
  } = $props()

  const WHEEL_COMMIT_MS = 150

  let el: HTMLDivElement

  // Live Ctrl + mouse wheel / pinch preview: the committed layout is CSS-scaled by
  // preview.scale / session.scale around `origin` (content coordinates) until
  // the gesture pauses (wheel) or ends (touchscreen pinch) and the zoom is committed.
  let preview = $state<{ scale: number; origin: { x: number; y: number } } | null>(null)
  let zoomAnchor = { x: 0, y: 0 }
  let commitTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Text-selecting tools: tint for the native selection in the text layers
   * ('hidden' when the tool previews its result instead).
   */
  const selectionColor = $derived.by(() => {
    const s = tool?.textSelection?.()
    return s ? (s.color ?? 'hidden') : null
  })
  /**
   * A text-selecting tool routed by hover (marker SmartMark): the overlay
   * lets the pointer through only near text, so the text layers show the
   * text cursor there, also beside the glyphs (read reactively).
   */
  const textCursor = $derived(selectionColor !== null && !!tool?.passThroughAt)
  const drawWithFinger = $derived(settings.data.preferences.drawWithFinger)
  const penButtons = $derived({ side: settings.data.preferences.penSideButton, end: settings.data.preferences.penEraserButton })

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

  let pagesEl: HTMLDivElement
  /** The running page-flip animation (see DocumentSession.flipAnimation). */
  let flipAnim: Animation | null = null
  /** Ease-out (cubic): fast start, so a flip feels immediate. */
  const FLIP_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)'

  function stopFlipAnimation() {
    flipAnim?.cancel()
    flipAnim = null
  }

  // Apply programmatic scroll changes (zoom, goToPage, tab restore, page
  // flips) to the DOM. Runs after the DOM update, so the content already has
  // its new size. Any of them ends a running flip animation.
  $effect(() => {
    const top = session.scrollTop
    const left = session.scrollLeft
    if (Math.abs(el.scrollTop - top) >= 1 || Math.abs(el.scrollLeft - left) >= 1) stopFlipAnimation()
    if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top
    if (Math.abs(el.scrollLeft - left) >= 1) el.scrollLeft = left
    // The browser clamps out-of-range positions without always firing a scroll event.
    if (Math.abs(el.scrollTop - top) >= 1 || Math.abs(el.scrollLeft - left) >= 1) {
      session.setScroll(el.scrollTop, el.scrollLeft)
    }
  })

  // Play a page flip's animation (after the scroll effect above, which would
  // stop it): the view is already at the flip's end, transformed to look like
  // its start, and eases to no transform. Runs on the compositor; the pages
  // are drawn once, at the final zoom.
  $effect(() => {
    const f = session.flipAnimation
    if (!f) return
    session.flipAnimation = null
    stopFlipAnimation()
    if (typeof pagesEl.animate !== 'function') return
    const anim = pagesEl.animate(
      [
        { transform: `translate(${f.x}px, ${f.y}px) scale(${f.a})`, transformOrigin: '0 0' },
        { transform: 'translate(0px, 0px) scale(1)', transformOrigin: '0 0' },
      ],
      { duration: f.ms, easing: FLIP_EASING },
    )
    anim.onfinish = () => {
      if (flipAnim === anim) flipAnim = null
    }
    flipAnim = anim
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
    stopFlipAnimation()
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

  // Touchpad pinch arrives as Ctrl+wheel; Ctrl + two-finger scroll looks the
  // same but scrolls instead (see ctrlWheelAction). Set up on mount.
  let ctrlKey: ReturnType<typeof trackCtrlKey> | undefined

  function onWheel(e: WheelEvent) {
    stopFlipAnimation()
    const action = ctrlWheelAction(e, ctrlKey?.held() ?? false)
    if (!action) return
    // Cancelled either way, or WebView2 would zoom the whole UI.
    e.preventDefault()
    if (action === 'scroll') {
      // A pending zoom preview is anchored to the current scroll position.
      commitZoom()
      // As if Ctrl weren't held; the scroll event syncs the session.
      el.scrollTop += e.deltaY
      el.scrollLeft += e.deltaX
      return
    }
    if (!preview) {
      const r = el.getBoundingClientRect()
      zoomAnchor = { x: e.clientX - r.left, y: e.clientY - r.top }
      preview = {
        scale: session.scale,
        origin: { x: el.scrollLeft + zoomAnchor.x, y: el.scrollTop + zoomAnchor.y },
      }
    }
    preview.scale = clampScale(preview.scale * wheelZoomFactor(e.deltaY, e.deltaMode))
    clearTimeout(commitTimer)
    commitTimer = setTimeout(commitZoom, WHEEL_COMMIT_MS)
  }

  // Touchscreen pinch (the WebView's own pinch is off, see base.css): the same
  // preview as touchpad pinch, anchored between the fingers, committed once
  // the fingers lift. Touch events, not pointer events: they keep coming when
  // the browser takes a finger for scrolling, and cancelling them stops that.
  let pinch: Pinch | null = null
  let pinchLastMid: { x: number; y: number } | null = null
  let touchPan: { id: number; x: number; y: number; moved: boolean } | null = null
  const TOUCH_PAN_IGNORE = 'textarea, input, button, [data-page-ui]'
  const isStylusTouch = (t: Touch): boolean => (t as Touch & { touchType?: string }).touchType === 'stylus'
  const hasStylusTouch = (touches: TouchList): boolean => {
    for (let i = 0; i < touches.length; i++) if (isStylusTouch(touches[i])) return true
    return false
  }

  function onTouchStart(e: TouchEvent) {
    stopFlipAnimation()
    if (penNear() || hasStylusTouch(e.touches)) {
      touchPan = null
      return
    }
    if (e.touches.length >= 2) {
      // No native scroll under the fingers while they pinch.
      e.preventDefault()
      // A finger may have started a stroke on a page (the first one, or one more
      // during the pinch): it is part of the pinch.
      cancelTouchGestures()
      touchPan = null
      if (pinch) return
      const start = startPinch(e.touches, session.scale)
      if (!start) return
      commitZoom()
      pinch = start.pinch
      pinchLastMid = start.mid
      const r = el.getBoundingClientRect()
      zoomAnchor = { x: start.mid.x - r.left, y: start.mid.y - r.top }
      preview = {
        scale: session.scale,
        origin: { x: el.scrollLeft + zoomAnchor.x, y: el.scrollTop + zoomAnchor.y },
      }
      return
    }
    if (e.touches.length === 1 && !drawWithFinger && !pinch) {
      if (e.target instanceof Element && e.target.closest(TOUCH_PAN_IGNORE)) return
      const t = e.touches[0]
      touchPan = { id: t.identifier, x: t.clientX, y: t.clientY, moved: false }
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (pinch) {
      e.preventDefault()
      const next = pinchState(pinch, e.touches)
      if (next) {
        if (pinchLastMid) {
          el.scrollLeft -= next.mid.x - pinchLastMid.x
          el.scrollTop -= next.mid.y - pinchLastMid.y
        }
        pinchLastMid = next.mid
        const r = el.getBoundingClientRect()
        zoomAnchor = { x: next.mid.x - r.left, y: next.mid.y - r.top }
        if (preview) preview.scale = next.scale
      }
      return
    }
    if (touchPan) {
      if (penNear() || hasStylusTouch(e.touches)) {
        touchPan = null
        return
      }
      let t: Touch | undefined
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchPan.id) {
          t = e.touches[i]
          break
        }
      }
      if (!t) {
        touchPan = null
        return
      }
      const dx = t.clientX - touchPan.x
      const dy = t.clientY - touchPan.y
      if (!touchPan.moved && Math.hypot(dx, dy) < 3) return
      touchPan.moved = true
      e.preventDefault()
      el.scrollLeft -= dx
      el.scrollTop -= dy
      touchPan.x = t.clientX
      touchPan.y = t.clientY
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (touchPan) {
      let active = false
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchPan.id) {
          active = true
          break
        }
      }
      if (!active) touchPan = null
    }
    if (!pinch || pinchState(pinch, e.touches) !== null) return
    pinch = null
    pinchLastMid = null
    commitZoom()
  }

  function commitZoom() {
    clearTimeout(commitTimer)
    if (!preview) return
    const scale = preview.scale
    preview = null
    session.zoomTo(scale, zoomAnchor)
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
    ctrlKey = trackCtrlKey(window)
    const stopPenTrack = trackPen(() => {
      touchPan = null
    })
    // Non-passive so preventDefault stops WebView2 from zooming the whole UI.
    el.addEventListener('wheel', onWheel, { passive: false })
    // Non-passive so a pinch can stop native scrolling (only while two fingers are down).
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
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
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      pinch = null
      pinchLastMid = null
      touchPan = null
      stopPenTrack()
      ctrlKey?.dispose()
      stopFlipAnimation()
      commitZoom()
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
      bind:this={pagesEl}
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
          {textCursor}
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
            {penLasso}
            {penGroup}
            {penButtons}
            {ontoolpress}
            {onpagemenu}
            {frames}
            rescrollMoves={!!crossDrag}
            {onstyle}
            hint={toolHint?.page === i ? toolHint.text : null}
            cursor={panning ? 'grabbing' : spaceHeld ? 'grab' : cursor}
            {drawWithFinger}
          />
        </PageView>
        {@const field = session.fieldStates[i]}
        {#if field && field !== 'none'}
          {@const box = fieldBox(pageLeft(layout, i, session.viewportW), layout.widths[i], width, PAGE_GAP)}
          <ExplanationField
            {session}
            index={i}
            mode={field}
            explanation={session.explanations[i] ?? null}
            top={layout.tops[i] + layout.heights[i] + FIELD_GAP}
            left={box.left}
            width={box.width}
            ai={field === 'note' ? null : fieldAi(session, settings.data.preferences, i)}
          />
        {/if}
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
  /*
   * Override base.css (`* { touch-action: pan-x pan-y }`) on pages and text
   * layer spans so pen drags (drawing, text marking, pen-button erasing)
   * never trigger native WebView2 scrolling; finger scrolling is handled by
   * touchPan and two-finger pinch in Viewer.svelte. TextEditor sets its own
   * touch-action on its <textarea>.
   */
  .viewer :global(.page),
  .viewer :global(.page > canvas),
  .viewer :global(.text-layer),
  .viewer :global(.text-layer *) {
    touch-action: none;
  }
</style>
