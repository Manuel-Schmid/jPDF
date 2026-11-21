<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { PageEntry } from '../session/pages'
  import { entryOf, sourceViewport } from './pageSource'
  import type { PdfDoc } from './pdfEngine'
  import { quadToViewport, type SearchHit } from './search'

  let {
    doc,
    pageNumber,
    entry,
    scale,
    hits,
    current = null,
  }: {
    doc: PdfDoc
    /** 1-based position in the page list. */
    pageNumber: number
    entry?: PageEntry
    /** CSS scale. */
    scale: number
    /** The search hits on this page. */
    hits: readonly SearchHit[]
    /** The hit the search is on (drawn stronger). */
    current?: SearchHit | null
  } = $props()

  let viewport = $state.raw<PageViewport | null>(null)

  $effect(() => {
    const shows = entryOf(pageNumber, entry)
    const s = scale
    if (shows.kind !== 'source') {
      viewport = null
      return
    }
    let cancelled = false
    doc
      .getPage(shows.source + 1)
      .then((page) => {
        if (!cancelled) viewport = sourceViewport(page, shows, s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  })

  const shapes = $derived.by(() => {
    const vp = viewport
    if (!vp) return []
    return hits.flatMap((h) => h.quads.map((q) => ({ points: quadToViewport(q, vp).join(','), current: h === current })))
  })
</script>

<!-- Drawn over the page, never part of it: nothing here is saved into the PDF. -->
<svg class="search-hits" aria-hidden="true">
  {#each shapes as s, i (i)}
    <polygon points={s.points} class:current={s.current} />
  {/each}
</svg>

<style>
  .search-hits {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    mix-blend-mode: multiply;
  }
  polygon {
    fill: rgb(255 212 0 / 0.45);
  }
  polygon.current {
    fill: rgb(255 128 0 / 0.65);
    stroke: rgb(230 100 0);
    stroke-width: 1;
  }
</style>
