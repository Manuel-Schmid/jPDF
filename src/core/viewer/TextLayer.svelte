<script lang="ts">
  import { TextLayer } from 'pdfjs-dist'
  import type { RGB } from '../session/model'
  import type { PageEntry } from '../session/pages'
  import { entryOf, sourceViewport } from './pageSource'
  import type { PdfDoc } from './pdfEngine'
  import { pageHasText, textContentOf } from './textContent'
  import { registerTextLayer, selectionTint } from './textLayers'
  import { clientToPdf } from './viewerMath'

  let {
    doc,
    pageNumber,
    entry,
    scale,
    selectionColor = null,
    textCursor = false,
  }: {
    doc: PdfDoc
    /** 1-based position in the page list. */
    pageNumber: number
    /** What the page shows (default: file page `pageNumber`); an empty page has no text. */
    entry?: PageEntry
    /** CSS scale (not multiplied by devicePixelRatio). */
    scale: number
    /** Tints the native selection (marker text mode), 'hidden' = not drawn; null = default selection colour. */
    selectionColor?: RGB | 'hidden' | null
    /**
     * The text cursor on the whole layer, not only over glyphs (marker
     * SmartMark): the overlay lets the pointer through only within reach of
     * text, so it shows exactly where a press highlights.
     */
    textCursor?: boolean
  } = $props()

  /** Same box as the page (and the overlay); pdf.js renders its layer inside. */
  let host: HTMLDivElement

  const tint = $derived(selectionTint(selectionColor))

  // Re-rendered whenever the committed scale changes (not during a zoom
  // preview, which CSS-scales the whole page including this layer).
  $effect(() => {
    const s = scale
    const pdf = doc
    const shows = entryOf(pageNumber, entry)
    const index = pageNumber - 1
    let cancelled = false
    let task: TextLayer | null = null
    let unregister: (() => void) | null = null
    void (async () => {
      // No text (an empty or scanned page): drop the layer of what was shown before.
      if (shows.kind !== 'source') {
        host.replaceChildren()
        return
      }
      const page = await pdf.getPage(shows.source + 1)
      if (cancelled) return
      if (!(await pageHasText(page))) {
        if (!cancelled) host.replaceChildren()
        return
      }
      if (cancelled) return
      const textContentSource = await textContentOf(page)
      if (cancelled) return
      const viewport = sourceViewport(page, shows, s)
      const container = document.createElement('div')
      container.className = 'textLayer'
      container.style.setProperty('--scale-factor', String(s))
      container.style.setProperty('--user-unit', String(page.userUnit ?? 1))
      task = new TextLayer({ textContentSource, container, viewport })
      await task.render()
      if (cancelled) return
      // Swap only once rendered, so the previous layer stays selectable meanwhile.
      host.replaceChildren(container)
      unregister = registerTextLayer(host, {
        page: index,
        toPdf: (x, y) => clientToPdf(x, y, host.getBoundingClientRect(), viewport),
      })
    })().catch((e: unknown) => {
      // Cancelled layers and layers of a closed tab's doc reject by design.
      if (!cancelled && !pdf.destroyed) console.error(`Failed to render text layer of page ${pageNumber}`, e)
    })
    return () => {
      cancelled = true
      task?.cancel()
      unregister?.()
    }
  })
</script>

<div bind:this={host} class="text-layer" class:tinted={tint} class:text-cursor={textCursor} style:--selection-tint={tint}></div>

<style>
  /* Minimal subset of pdfjs-dist/web/pdf_viewer.css for the text layer. */
  .text-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .text-layer :global(.textLayer) {
    --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
    --scale-round-x: 1px;
    --scale-round-y: 1px;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
    position: absolute;
    inset: 0;
    text-align: initial;
    overflow: clip;
    line-height: 1;
    letter-spacing: normal;
    word-spacing: normal;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: CanvasText;
    z-index: 0;
  }
  .text-layer :global(.textLayer[data-main-rotation='90']) {
    transform: rotate(90deg) translateY(-100%);
  }
  .text-layer :global(.textLayer[data-main-rotation='180']) {
    transform: rotate(180deg) translate(-100%, -100%);
  }
  .text-layer :global(.textLayer[data-main-rotation='270']) {
    transform: rotate(270deg) translateX(-100%);
  }
  .text-layer.text-cursor {
    cursor: text;
  }
  .text-layer :global(.textLayer :is(span, br)) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    user-select: text;
  }
  .text-layer :global(.textLayer > :not(.markedContent)),
  .text-layer :global(.textLayer .markedContent span:not(.markedContent)) {
    z-index: 1;
    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }
  .text-layer :global(.textLayer .markedContent) {
    display: contents;
  }
  .text-layer :global(.textLayer span[role='img']) {
    user-select: none;
    cursor: default;
  }
  .text-layer :global(.textLayer ::selection) {
    background: color-mix(in srgb, AccentColor, transparent 50%);
    color: transparent;
  }
  .tinted :global(.textLayer ::selection) {
    background: var(--selection-tint);
  }
  .text-layer :global(.textLayer br::selection) {
    background: transparent;
  }
  .text-layer :global(.textLayer .endOfContent) {
    display: block;
    position: absolute;
    inset: 100% 0 0;
    z-index: 0;
    cursor: default;
    user-select: none;
  }
  .text-layer :global(.textLayer.selecting .endOfContent) {
    top: 0;
  }
</style>
