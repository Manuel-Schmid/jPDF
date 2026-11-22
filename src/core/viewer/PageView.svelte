<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte'
  import { AnnotationMode, type RenderTask } from 'pdfjs-dist'
  import type { RGB } from '../session/model'
  import type { PageEntry } from '../session/pages'
  import { entryOf, renderKey, sourceViewport } from './pageSource'
  import type { PdfDoc } from './pdfEngine'
  import TextLayer from './TextLayer.svelte'
  import { releaseCanvas, renderCache } from './renderCache'
  import { renderScale } from './viewerMath'

  let {
    doc,
    cacheId,
    pageNumber,
    entry,
    annotations = true,
    pageSize,
    scale,
    left,
    top,
    selectionColor = null,
    children,
  }: {
    doc: PdfDoc
    /** Render-cache namespace (the session id). */
    cacheId: string
    /** 1-based position in the page list. */
    pageNumber: number
    /** What the page shows; default: file page `pageNumber`, unrotated. */
    entry?: PageEntry
    /**
     * Whether pdf.js draws the file page's annotations (those it does not
     * suppress). False for a duplicate: only the first occurrence of a file
     * page keeps the file's annotations when saved.
     */
    annotations?: boolean
    /** Page size at scale 1, in points. */
    pageSize: { width: number; height: number }
    scale: number
    left: number
    top: number
    /** Tints text selection in the text layer (marker text mode); null = default. */
    selectionColor?: RGB | 'hidden' | null
    /** Later layers (annotation overlay) stacked above the canvas and text layer. */
    children?: Snippet
  } = $props()

  const shows = $derived(entryOf(pageNumber, entry))

  let pageEl: HTMLDivElement
  /**
   * The canvas on screen: the one pdf.js rendered into, shared with the render
   * cache (no copy). Inserted as the page's first child, under the layers.
   */
  let shown: HTMLCanvasElement | null = null
  /** Bumped when the shown canvas lost its pixels (GPU reset): render again. */
  let contextResets = $state(0)

  // Re-render when the display scale changes (window moved to another monitor,
  // Windows scaling changed): the media query matches the current ratio only.
  let dpr = $state(window.devicePixelRatio || 1)
  $effect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => (dpr = window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  onDestroy(() => {
    // A cached canvas stays for scrolling back; the cache frees it on eviction.
    if (shown && !renderCache.holds(shown)) {
      shown.width = 0
      shown.height = 0
    }
    // Once the page has left the DOM its canvas is no longer pinned: let the
    // cache drop it if the off-screen pages exceed the budget.
    queueMicrotask(() => renderCache.trim())
    // Off screen: free the page's operator lists and page-level objects in
    // pdf.js (document-level fonts stay; pdf.js defers this until a
    // still-running render has finished).
    if (shows.kind !== 'source') return
    doc
      .getPage(shows.source + 1)
      .then((page) => {
        if (!doc.destroyed) page.cleanup()
      })
      .catch(() => {})
  })

  /** An empty page: no canvas (the page background is the paper). */
  function hide() {
    const old = shown
    if (!old) return
    shown = null
    old.remove()
    if (!renderCache.holds(old)) releaseCanvas(old)
  }

  /** Swaps `c` in for the canvas on screen in one step: no blank frame. */
  function show(c: HTMLCanvasElement) {
    const old = shown
    if (old === c) return
    shown = c
    if (old) old.replaceWith(c)
    else pageEl.prepend(c)
    if (old && !renderCache.holds(old)) releaseCanvas(old)
  }

  $effect(() => {
    void contextResets
    const page = shows
    const pdf = doc
    if (page.kind !== 'source') {
      hide()
      return
    }
    const rs = renderScale(pageSize.width, pageSize.height, scale, dpr)
    const key = renderKey(cacheId, pageNumber, rs, page, annotations)
    const drawAnnotations = annotations
    const cached = renderCache.get(key)
    if (cached) {
      show(cached)
      return
    }

    let cancelled = false
    let task: RenderTask | null = null
    void (async () => {
      const proxy = await pdf.getPage(page.source + 1)
      if (cancelled) return
      const viewport = sourceViewport(proxy, page, rs)
      // Render off-screen so the previous (CSS-scaled) canvas stays visible meanwhile.
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      // A GPU canvas loses its pixels on a GPU reset. preventDefault() lets the
      // browser restore the 2D context; it comes back blank, so render again.
      off.addEventListener('contextlost', (e) => e.preventDefault())
      off.addEventListener('contextrestored', () => {
        renderCache.evict(off)
        if (shown === off) contextResets++
      })
      try {
        // ENABLE_STORAGE: annotations the session manages are suppressed (noView).
        const annotationMode = drawAnnotations ? AnnotationMode.ENABLE_STORAGE : AnnotationMode.DISABLE
        task = proxy.render({ canvas: off, viewport, annotationMode })
        await task.promise
      } catch (e) {
        releaseCanvas(off)
        throw e
      }
      if (cancelled) {
        releaseCanvas(off)
        return
      }
      // Shown first: the cache never frees a canvas that is on screen.
      show(off)
      renderCache.set(key, off)
    })().catch((e: unknown) => {
      // Cancelled renders and renders of a closed tab's doc reject by design.
      if (!cancelled && !pdf.destroyed) console.error(`Failed to render page ${pageNumber}`, e)
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  })
</script>

<div
  bind:this={pageEl}
  class="page"
  style:left="{left}px"
  style:top="{top}px"
  style:width="{pageSize.width * scale}px"
  style:height="{pageSize.height * scale}px"
>
  <TextLayer {doc} {pageNumber} entry={shows} {scale} {selectionColor} />
  {@render children?.()}
</div>

<style>
  .page {
    position: absolute;
    overflow: hidden;
    background: var(--page-bg);
    box-shadow: var(--page-shadow);
    contain: strict;
  }
  /*
   * Dark page colours: one filter over the whole page (canvas, text
   * selection, annotations), so it reads as one dark document and dark ink
   * stays visible. A colour filter is composited on the GPU: no re-render.
   */
  :global(:root[data-page-colors='dark']) .page,
  :global(:root[data-page-colors='theme'][data-theme='dark']) .page {
    filter: var(--page-dark-filter);
    box-shadow: var(--page-shadow-dark);
  }
  .page > :global(canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
