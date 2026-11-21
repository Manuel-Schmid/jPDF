<script lang="ts">
  import { untrack } from 'svelte'
  import { firstOccurrences } from '../session/pages'
  import type { DocumentSession } from '../session/session.svelte'
  import { visibleRange } from './layout'
  import SidebarThumb from './SidebarThumb.svelte'
  import { scrollToShow, thumbnailLayout } from './thumbnailList'

  /**
   * Page thumbnails beside the page area: click one to go to its page. The
   * column is laid out from the page sizes (thumbnailList.ts) and only the
   * tiles in view (plus a few) are mounted, so a long document costs no more
   * than a short one. Mounted only while open.
   */
  let { session, side }: { session: DocumentSession; side: 'left' | 'right' } = $props()

  /** Tiles mounted beyond each end of the view. */
  const OVERSCAN = 3

  let scroller: HTMLDivElement
  let scrollTop = $state(0)
  let viewH = $state(0)

  const layout = $derived(thumbnailLayout(session.pageSizes))
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

  // The current page stays in view as the document scrolls (and on opening).
  $effect(() => {
    const i = session.currentPage - 1
    const h = viewH
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
</script>

<nav class="sidebar" class:right={side === 'right'} aria-label="Page thumbnails">
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
          current={session.currentPage === i + 1}
          onopen={open}
        />
      {/each}
    </div>
  </div>
</nav>

<style>
  .sidebar {
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
</style>
