import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageEntry } from '../session/pages'
import type { Point } from '../session/model'
import type { TextContent } from './textContent'
import { textContentOf } from './textContent'

/**
 * A text run's box in PDF user space: a parallelogram from `origin` along
 * `u` (the run's direction and length) and `v` (up, the line's height).
 * Rotated and skewed text keeps its shape.
 */
export interface TextBox {
  origin: Point
  u: Point
  v: Point
}

/** How far below the baseline a run's box reaches, as a share of its height (descenders). */
const DESCENT = 0.25

/**
 * The boxes of the non-blank text runs in pdf.js text content. Item width
 * and height are in user space; the transform gives position and direction.
 */
export function textBoxes(items: TextContent['items']): TextBox[] {
  const out: TextBox[] = []
  for (const item of items) {
    if (!('str' in item) || item.str.trim() === '' || !(item.width > 0)) continue
    const [a, b, c, d, e, f] = item.transform as number[]
    const along = Math.hypot(a, b)
    const up = Math.hypot(c, d)
    if (along === 0 || up === 0) continue
    const h = item.height > 0 ? item.height : up
    const u: Point = [(a / along) * item.width, (b / along) * item.width]
    const v: Point = [(c / up) * h * (1 + DESCENT), (d / up) * h * (1 + DESCENT)]
    // Shifted down by the descent, so the box covers descenders too.
    const origin: Point = [e - (c / up) * h * DESCENT, f - (d / up) * h * DESCENT]
    out.push({ origin, u, v })
  }
  return out
}

/** Whether `p` lies in the box grown by `tolerance` (pt) on every side. */
export function onTextBox(p: Point, box: TextBox, tolerance = 0): boolean {
  const { origin, u, v } = box
  const det = u[0] * v[1] - u[1] * v[0]
  if (det === 0) return false
  const dx = p[0] - origin[0]
  const dy = p[1] - origin[1]
  // p - origin = s·u + t·v
  const s = (dx * v[1] - dy * v[0]) / det
  const t = (u[0] * dy - u[1] * dx) / det
  const su = tolerance / Math.hypot(u[0], u[1])
  const tv = tolerance / Math.hypot(v[0], v[1])
  return s >= -su && s <= 1 + su && t >= -tv && t <= 1 + tv
}

/** Where text is on the pages of a document: true/false, or null while not (yet) known. */
export type TextLookup = (page: number, p: Point, tolerance: number) => boolean | null

/**
 * A TextLookup for the document's shown pages (`pages()[i]` is page i).
 * A page's text boxes load on its first lookup, which answers null until
 * they are there (or for good, if they cannot be read). Empty pages have no text.
 */
export function createTextLookup(
  pages: () => readonly PageEntry[] | undefined,
  getPage: (source: number) => Promise<PDFPageProxy> | undefined,
): TextLookup {
  const loaded = new WeakMap<PageEntry, TextBox[] | 'loading' | 'failed'>()
  return (page, p, tolerance) => {
    const entry = pages()?.[page]
    if (!entry) return null
    if (entry.kind === 'blank') return false
    const boxes = loaded.get(entry)
    if (boxes === undefined) {
      const pending = getPage(entry.source)
      if (!pending) return null
      loaded.set(entry, 'loading')
      pending
        .then(textContentOf)
        .then((c) => loaded.set(entry, textBoxes(c.items)))
        .catch(() => loaded.set(entry, 'failed'))
      return null
    }
    if (boxes === 'loading' || boxes === 'failed') return null
    return boxes.some((b) => onTextBox(p, b, tolerance))
  }
}
