import type { Point } from '../session/model'

/** A rendered text layer: its page and how its client coordinates map to PDF space. */
export interface TextLayerPage {
  /** 0-based, matches Annotation.page. */
  page: number
  toPdf(clientX: number, clientY: number): Point
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

/**
 * The mounted text layer of the page `node` is on: the layer containing it,
 * or the one beside it in the same page element (a press on the overlay).
 * Found by element, not page number: a page may be shown twice.
 */
export function textLayerFor(node: Node): [Element, TextLayerPage] | null {
  for (const [el, info] of layers) {
    if (el.contains(node) || el.parentElement?.contains(node)) return [el, info]
  }
  return null
}
