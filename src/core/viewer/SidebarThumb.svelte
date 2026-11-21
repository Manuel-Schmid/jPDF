<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import { annotationKinds } from '../registry/annotationKinds'
  import type { Annotation } from '../session/model'
  import type { PageEntry } from '../session/pages'
  import type { DocumentSession } from '../session/session.svelte'
  import { blankViewport, sourceViewport } from './pageSource'
  import { SIDEBAR_TILE, thumbnailSize } from './thumbnailList'
  import { drawThumbnail, requestThumbnail, thumbnailPx } from './thumbnails'

  let {
    session,
    index,
    entry,
    first,
    top,
    height,
    current,
    onopen,
  }: {
    session: DocumentSession
    /** 0-based position in the page list. */
    index: number
    entry: PageEntry
    /** Whether this is the first copy of its file page (only it shows the file's own annotations). */
    first: boolean
    /** Position and height in the column (thumbnailLayout). */
    top: number
    height: number
    /** The page the viewer shows. */
    current: boolean
    onopen: (i: number) => void
  } = $props()

  /** Edits reach the preview this long after the last change (never mid-edit). */
  const REFRESH_MS = 300

  let canvas: HTMLCanvasElement
  let drawn = $state(false)
  const dpr = window.devicePixelRatio || 1

  const pageSize = $derived(session.pageSizes[index] ?? { width: 612, height: 792 })
  const size = $derived(thumbnailSize(pageSize.width, pageSize.height))
  const k = $derived(size.w / pageSize.width)

  /** Waits for the browser to be idle: the viewer's own pages render first. */
  function whenIdle(fn: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(fn, { timeout: 1000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(fn, 50)
    return () => clearTimeout(id)
  }

  $effect(() => {
    if (entry.kind !== 'source') {
      drawn = false
      return
    }
    const shows = entry
    const rotate = shows.rotate
    const quarter = Math.abs(rotate) % 180 === 90
    // Low resolution, sized for the tallest preview: one cached render serves every rotation.
    const px = thumbnailPx(SIDEBAR_TILE.maxH, dpr)
    let cancelled = false
    let cancelRequest = () => {}
    const cancelIdle = whenIdle(() => {
      if (cancelled) return
      const req = requestThumbnail(session.doc, session.id, shows.source, first, px)
      cancelRequest = req.cancel
      req.promise
        .then((src) => {
          if (cancelled) return
          canvas.width = quarter ? src.height : src.width
          canvas.height = quarter ? src.width : src.height
          drawThumbnail(canvas, src, rotate)
          drawn = true
        })
        .catch((e: unknown) => {
          if (cancelled || session.doc.destroyed || (e instanceof DOMException && e.name === 'AbortError')) return
          console.error(`Failed to render thumbnail of page ${index + 1}`, e)
        })
    })
    return () => {
      cancelled = true
      cancelIdle()
      cancelRequest()
    }
  })

  // Annotations JuliePDF draws itself (pdf.js does not render them), refreshed
  // debounced: a burst of edits redraws the preview once.
  let annotations = $state.raw<Annotation[]>([])
  let primed = false
  $effect(() => {
    const next = session.store.byPage(index)
    if (!primed) {
      primed = true
      annotations = next
      return
    }
    const id = setTimeout(() => (annotations = next), REFRESH_MS)
    return () => clearTimeout(id)
  })

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
  type="button"
  class="tile"
  class:current
  style:top="{top}px"
  style:height="{height}px"
  aria-label="Page {index + 1}"
  aria-current={current ? 'page' : undefined}
  onclick={() => onopen(index)}
>
  <span class="page" class:loading={entry.kind === 'source' && !drawn} style:width="{size.w}px" style:height="{size.h}px">
    <canvas bind:this={canvas}></canvas>
    {#if annotations.length > 0 && vp}
      <svg class="annotations" viewBox="0 0 {vp.width} {vp.height}" preserveAspectRatio="none" width="100%" height="100%">
        {#each annotations as a (a.id)}
          {@const K = annotationKinds.get(a.kind)}
          <K.Render {a} {vp} selected={false} />
        {/each}
      </svg>
    {/if}
  </span>
  <span class="label">{index + 1}</span>
</button>

<style>
  .tile {
    position: absolute;
    left: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding: 8px 0 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .page {
    position: relative;
    flex: none;
    overflow: hidden;
    background: var(--page-bg);
    box-shadow: var(--page-shadow);
  }
  .page.loading {
    background: var(--page-loading);
  }
  .tile.current .page {
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
  .label {
    flex: none;
    height: 20px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
  }
  .tile.current .label {
    color: var(--accent);
    font-weight: 600;
  }
</style>
