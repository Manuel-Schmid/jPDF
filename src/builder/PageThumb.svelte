<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import { annotationKinds } from '../core/registry/annotationKinds'
  import type { PageEntry } from '../core/session/pages'
  import type { DocumentSession } from '../core/session/session.svelte'
  import { blankViewport, sourceViewport } from '../core/viewer/pageSource'
  import { drawThumbnail, requestThumbnail, thumbnailPx } from '../core/viewer/thumbnails'

  let {
    session,
    index,
    entry,
    first,
    size,
    renderSize,
    selected,
    observe,
    onselect,
    onopen,
  }: {
    session: DocumentSession
    /** 0-based position in the page list. */
    index: number
    entry: PageEntry
    /** Whether this is the first copy of its file page (only it shows the file's own annotations). */
    first: boolean
    /** Tile box (CSS px): the page is fitted into a square of this size. */
    size: number
    /** Box size the thumbnail is rendered for (the slider's committed value). */
    renderSize: number
    selected: boolean
    /** Calls back with whether the tile is near the viewport; returns the unsubscribe. */
    observe: (el: Element, cb: (visible: boolean) => void) => () => void
    onselect: (i: number, e: MouseEvent) => void
    onopen: (i: number) => void
  } = $props()

  let el: HTMLButtonElement
  let canvas: HTMLCanvasElement
  /** Near the viewport: only these tiles hold pixels. */
  let visible = $state(false)
  let drawn = $state(false)
  const dpr = window.devicePixelRatio || 1

  $effect(() => observe(el, (v) => (visible = v)))

  const pageSize = $derived(session.pageSizes[index] ?? { width: 612, height: 792 })
  const k = $derived(Math.min(size / pageSize.width, size / pageSize.height))
  const w = $derived(Math.max(1, Math.round(pageSize.width * k)))
  const h = $derived(Math.max(1, Math.round(pageSize.height * k)))

  $effect(() => {
    if (!visible || entry.kind !== 'source') {
      // Off screen (or an empty page): give the pixels back.
      canvas.width = 0
      canvas.height = 0
      drawn = false
      return
    }
    const rotate = entry.rotate
    const quarter = Math.abs(rotate) % 180 === 90
    const px = thumbnailPx(renderSize, dpr)
    const req = requestThumbnail(session.doc, session.id, entry.source, first, px)
    let cancelled = false
    req.promise
      .then((src) => {
        if (cancelled) return
        // Canvas pixels: the cached render's own size, turned (no resampling to the tile size).
        canvas.width = quarter ? src.height : src.width
        canvas.height = quarter ? src.width : src.height
        drawThumbnail(canvas, src, rotate)
        drawn = true
      })
      .catch((e: unknown) => {
        if (cancelled || session.doc.destroyed || (e instanceof DOMException && e.name === 'AbortError')) return
        // pdf.js cancels renders of cleaned-up pages; anything else is worth a log.
        console.error(`Failed to render thumbnail of page ${index + 1}`, e)
      })
    return () => {
      cancelled = true
      req.cancel()
    }
  })

  /** Annotations JuliePDF draws itself (pdf.js does not render them). */
  const annotations = $derived(visible ? session.store.byPage(index) : [])
  let vp = $state.raw<PageViewport | null>(null)
  $effect(() => {
    if (annotations.length === 0) return
    const scale = k
    const shows = entry
    if (shows.kind === 'blank') {
      vp = blankViewport(shows.width, shows.height, scale, shows.rotate)
      return
    }
    let cancelled = false
    session.doc
      .getPage(shows.source + 1)
      .then((page) => {
        if (!cancelled) vp = sourceViewport(page, shows, scale)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  })
</script>

<button
  bind:this={el}
  type="button"
  class="tile"
  class:selected
  style:--box="{size}px"
  aria-pressed={selected}
  aria-label="Page {index + 1}"
  onclick={(e) => onselect(index, e)}
  ondblclick={() => onopen(index)}
>
  <span class="box">
    <span class="page" class:loading={entry.kind === 'source' && !drawn} style:width="{w}px" style:height="{h}px">
      <canvas bind:this={canvas}></canvas>
      {#if annotations.length > 0 && vp}
        <svg class="annotations" viewBox="0 0 {vp.width} {vp.height}" preserveAspectRatio="none" width="100%" height="100%">
          {#each annotations as a (a.id)}
            {@const K = annotationKinds.get(a.kind)}
            <K.Render {a} {vp} selected={false} />
          {/each}
        </svg>
      {/if}
      <!-- Always in the DOM, shown by CSS: selecting hundreds of pages mounts nothing. -->
      <svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  </span>
  <span class="label">{index + 1}</span>
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 12px 8px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    /* Off-screen tiles skip layout and paint. */
    content-visibility: auto;
    contain-intrinsic-size: auto calc(var(--box) + 24px) auto calc(var(--box) + 52px);
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile.selected {
    background: var(--accent-soft);
  }
  .tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .box {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: var(--box);
    height: var(--box);
  }
  .page {
    position: relative;
    overflow: hidden;
    background: var(--page-bg);
    box-shadow: var(--page-shadow);
  }
  .page.loading {
    background: var(--page-loading);
  }
  .tile.selected .page {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  canvas,
  .annotations {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .annotations {
    pointer-events: none;
  }
  .check {
    position: absolute;
    inset: 4px auto auto 4px;
    display: none;
    width: 20px;
    height: 20px;
    padding: 3px;
    border-radius: 4px;
    background: var(--accent);
    fill: none;
    stroke: var(--bg-deep);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tile.selected .check {
    display: block;
  }
  .label {
    font-variant-numeric: tabular-nums;
  }
  .tile.selected .label {
    color: var(--text-strong);
  }
</style>
