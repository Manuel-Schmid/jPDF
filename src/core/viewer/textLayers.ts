import type { Point, RGB } from '../session/model'

/** A rendered text layer: its page and how its client coordinates map to PDF space. */
export interface TextLayerPage {
  /** 0-based, matches Annotation.page. */
  page: number
  toPdf(clientX: number, clientY: number): Point
  /**
   * The text of the page's text boxes (FreeText), stacked above the page's
   * own text layer (see FreeTextLayer): a drag that starts there stays in
   * it, and a press anywhere in a box reaches its text.
   */
  freeText?: boolean
}

const layers = new Map<Element, TextLayerPage>()

/** Registers a mounted text layer element; returns the unregister function. */
export function registerTextLayer(el: Element, info: TextLayerPage): () => void {
  layers.set(el, info)
  return () => {
    if (layers.get(el) === info) layers.delete(el)
  }
}

/** Currently mounted text layers. */
export function textLayers(): Iterable<[Element, TextLayerPage]> {
  return layers.entries()
}

/** Currently mounted text layers of the pages' own text (no text box layers). */
export function pageTextLayers(): [Element, TextLayerPage][] {
  return [...layers].filter(([, info]) => !info.freeText)
}

/**
 * The mounted text layer of the page `node` is on: the layer containing it,
 * or the page text layer beside it in the same page element (a press on the
 * overlay). Found by element, not page number: a page may be shown twice.
 */
export function textLayerFor(node: Node): [Element, TextLayerPage] | null {
  for (const entry of layers) if (entry[0].contains(node)) return entry
  for (const entry of layers) {
    if (!entry[1].freeText && entry[0].parentElement?.contains(node)) return entry
  }
  return null
}

/**
 * CSS colour of the native selection in text layers for a tool's selection
 * colour (see TextLayer's selectionColor): 'hidden' is not drawn; undefined
 * keeps the default selection colour.
 */
export function selectionTint(color: RGB | 'hidden' | null): string | undefined {
  if (color === 'hidden') return 'transparent'
  return color ? `rgba(${color.map((c) => Math.round(c * 255)).join(',')},0.35)` : undefined
}
