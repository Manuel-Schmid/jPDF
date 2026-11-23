<script lang="ts">
  import { untrack } from 'svelte'
  import { firstOccurrences } from '../session/pages'
  import type { DocumentSession } from '../session/session.svelte'
  import { visibleRange } from './layout'
  import SidebarThumb from './SidebarThumb.svelte'
  import { clampSidebarWidth, SIDEBAR_WIDTH, scrollToShow, thumbnailLayout, tileBox } from './thumbnailList'
  import { trackCtrlKey } from './ctrlKey'
  import { wheelPixels } from './viewerMath'

  /**
   * Page thumbnails beside the page area: click one to go to its page. The
   * column is laid out from the page sizes (thumbnailList.ts) and only the
   * tiles in view (plus a few) are mounted, so a long document costs no more
   * than a short one. Mounted only while open.
   *
   * The edge facing the pages resizes it: `width` is its width now (also the
   * grid column the parent gives it), `renderWidth` the settled width the
   * bitmaps are rendered for. A drag reports each new width through
   * `onresize` (`done` on release, when the parent saves it); the thumbnails
   * are laid out live and their bitmaps stretched until the drag ends, so a
   * drag never renders. Double-click resets the width; arrow keys step it.
   */
  let {
    session,
    side,
    width = SIDEBAR_WIDTH.initial,
    renderWidth = width,
    onresize,
  }: {
    session: DocumentSession
    side: 'left' | 'right'
    width?: number
    renderWidth?: number
    onresize?: (width: number, done: boolean) => void
  } = $props()

  /** Width change (px) per arrow key press on the resize handle. */
  const KEY_STEP = 16

  /** Tiles mounted beyond each end of the view. */
  const OVERSCAN = 3

  let scroller: HTMLDivElement
  let scrollTop = $state(0)
  let viewH = $state(0)

  const box = $derived(tileBox(width))
  const renderBox = $derived(tileBox(renderWidth))
  const layout = $derived(thumbnailLayout(session.pageSizes, box))
  const firsts = $derived(firstOccurrences(session.pages))
  const range = $derived(visibleRange(layout, scrollTop, viewH, OVERSCAN))
  const shown = $derived(
    viewH > 0 && range.last >= range.first
      ? Array.from({ length: range.last - range.first + 1 }, (_, k) => range.first + k)
      : [],
  )

  $effect(() => {
    viewH = scroller.clientHeight
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => (viewH = scroller.clientHeight))
    ro.observe(scroller)
    return () => ro.disconnect()
  })

  // Ctrl + scroll (Ctrl physically held: mouse wheel or two-finger touchpad
  // scroll) scrolls the thumbnails as if Ctrl weren't held; there is nothing to
  // zoom here. Cancelled so WebView2 doesn't zoom the UI. A touchpad pinch
  // (ctrlKey without Ctrl held) is left to pageZoomGuard, which cancels it.
  $effect(() => {
    const ctrlKey = trackCtrlKey(window)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !ctrlKey.held()) return
      e.preventDefault()
      scroller.scrollTop += wheelPixels(e.deltaY, e.deltaMode)
      scrollTop = scroller.scrollTop
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      ctrlKey.dispose()
    }
  })

  // The current page stays in view as the document scrolls (and on opening),
  // and as the tiles grow or shrink with the width.
  $effect(() => {
    const i = session.currentPage - 1
    const h = viewH
    void layout
    untrack(() => {
      const to = scrollToShow(layout, i, scroller.scrollTop, h)
      if (to === null) return
      scroller.scrollTop = to
      scrollTop = scroller.scrollTop
    })
  })

  function open(i: number) {
    session.goToPage(i + 1)
  }

  /** A resize drag: the pointer's client x and the width at the press. */
  let drag: { x: number; width: number } | null = null
  /** Dragging away from the pages widens the sidebar: rightwards when it is on the left. */
  const outward = $derived(side === 'left' ? 1 : -1)

  function onHandleDown(e: PointerEvent) {
    if (e.button !== 0 || !onresize) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag = { x: e.clientX, width }
  }

  function onHandleMove(e: PointerEvent) {
    if (!drag || !onresize) return
    const next = clampSidebarWidth(drag.width + (e.clientX - drag.x) * outward)
    if (next !== width) onresize(next, false)
  }

  function onHandleUp() {
    if (!drag) return
    drag = null
    onresize?.(width, true)
  }

  function onHandleKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? KEY_STEP : e.key === 'ArrowLeft' ? -KEY_STEP : 0
    if (!step || !onresize) return
    e.preventDefault()
    onresize(clampSidebarWidth(width + step * outward), true)
  }
</script>

<nav class="sidebar" class:right={side === 'right'} aria-label="Page thumbnails">
  {#if onresize}
    <!-- A focusable separator is the ARIA pattern for a resize handle. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resize"
      role="separator"
      aria-label="Resize page thumbnails"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      tabindex="0"
      title="Drag to resize · double-click to reset"
      onpointerdown={onHandleDown}
      onpointermove={onHandleMove}
      onpointerup={onHandleUp}
      onpointercancel={onHandleUp}
      ondblclick={() => onresize(SIDEBAR_WIDTH.initial, true)}
      onkeydown={onHandleKey}
    ></div>
  {/if}
  <div class="scroller" bind:this={scroller} onscroll={() => (scrollTop = scroller.scrollTop)}>
    <div class="column" style:height="{layout.totalHeight}px">
      {#each shown as i (i)}
        <SidebarThumb
          {session}
          index={i}
          entry={session.pages[i]}
          first={firsts[i]}
          top={layout.tops[i]}
          height={layout.heights[i]}
          {box}
          {renderBox}
          current={session.currentPage === i + 1}
          onopen={open}
        />
      {/each}
    </div>
  </div>
</nav>

<style>
  .sidebar {
    position: relative;
    height: 100%;
    min-height: 0;
    background: var(--bg-deep);
    border-right: 1px solid var(--border);
  }
  .sidebar.right {
    border-right: 0;
    border-left: 1px solid var(--border);
  }
  .scroller {
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .column {
    position: relative;
  }
  /* A strip over the inner edge (the border facing the pages), wider than it looks. */
  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -3px;
    width: 6px;
    z-index: 1;
    cursor: col-resize;
    touch-action: none;
  }
  .sidebar.right .resize {
    right: auto;
    left: -3px;
  }
  .resize:hover,
  .resize:focus-visible,
  .resize:active {
    background: var(--accent);
    opacity: 0.5;
    outline: none;
  }
</style>
