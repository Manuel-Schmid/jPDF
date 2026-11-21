/**
 * Text search in a document (pure helpers). A page's text items are joined
 * into one searchable string, lower-cased and with whitespace (line breaks
 * included) collapsed to single spaces, so a query matches across lines.
 * Each character of that string remembers the text item and offset it came
 * from, which is how a hit is turned back into boxes on the page.
 */
import type { PageViewport } from 'pdfjs-dist'
import type { TextContent } from './textContent'

/** One text item's placement (see pdf.js TextItem), kept for the highlight boxes. */
export interface TextGeom {
  str: string
  /** Text space to user space: [a, b, c, d, e, f], (e, f) is the baseline start. */
  transform: number[]
  /** Advance width in user space. */
  width: number
  /** Font size in user space. */
  height: number
  /** Font ascent as a fraction of the font size (0.8 when the font does not say). */
  ascent: number
}

export interface PageText {
  /** Normalized text of the page (lower case, single spaces). */
  text: string
  /** Text item of each character of `text`; -1 for a line break. */
  item: Int32Array
  /** Offset of each character of `text` in its item's string. */
  offset: Int32Array
  items: TextGeom[]
}

/** Quadrilateral in user space: four corners [x0, y0, x1, y1, x2, y2, x3, y3]. */
export type Quad = number[]

export interface SearchHit {
  /** 0-based position in the page list. */
  page: number
  /** Boxes of the hit in the page's user space (one per text item it spans). */
  quads: Quad[]
}

const SPACE = /\s/

/** Font ascent as pdf.js' TextLayer derives it from the text style. */
function ascentOf(style: { ascent?: number; descent?: number } | undefined): number {
  if (style?.ascent) return style.ascent
  if (style?.descent) return 1 + style.descent
  return 0.8
}

/** The searchable text of a page, from its pdf.js text content. */
export function buildPageText(content: Pick<TextContent, 'items' | 'styles'>): PageText {
  let text = ''
  const item: number[] = []
  const offset: number[] = []
  const items: TextGeom[] = []
  const space = (i: number, k: number) => {
    if (text !== '' && !text.endsWith(' ')) {
      text += ' '
      item.push(i)
      offset.push(k)
    }
  }
  for (const it of content.items) {
    if (!('str' in it)) continue // marked content
    const i = items.length
    const style = (content.styles as Record<string, { ascent?: number; descent?: number }>)[it.fontName]
    items.push({ str: it.str, transform: it.transform, width: it.width, height: it.height, ascent: ascentOf(style) })
    for (let k = 0; k < it.str.length; k++) {
      const ch = it.str[k]
      if (SPACE.test(ch)) {
        space(i, k)
        continue
      }
      // toLowerCase may change the length (rare): every unit maps to the same character.
      const low = ch.toLowerCase()
      for (let u = 0; u < low.length; u++) {
        text += low[u]
        item.push(i)
        offset.push(k)
      }
    }
    if (it.hasEOL) space(-1, 0)
  }
  return { text, item: Int32Array.from(item), offset: Int32Array.from(offset), items }
}

/** The query as it is matched: trimmed, lower case, whitespace collapsed. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Start offsets of the non-overlapping occurrences of `q` (normalized) in `text`. */
export function findAll(text: string, q: string): number[] {
  const out: number[] = []
  if (q === '') return out
  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) out.push(at)
  return out
}

/**
 * Boxes of the characters [start, end) of `page.text`: one per text item,
 * the item's glyph box cut proportionally to the characters it covers
 * (pdf.js gives no per-glyph positions; the text layer is drawn the same way).
 */
export function hitQuads(page: PageText, start: number, end: number): Quad[] {
  const quads: Quad[] = []
  let k = start
  while (k < end) {
    const i = page.item[k]
    if (i < 0) {
      k++
      continue
    }
    let from = page.offset[k]
    let to = from
    while (k < end && page.item[k] === i) {
      from = Math.min(from, page.offset[k])
      to = Math.max(to, page.offset[k])
      k++
    }
    const quad = itemQuad(page.items[i], from, to + 1)
    if (quad) quads.push(quad)
  }
  return quads
}

/** Box of characters [from, to) of a text item, in user space; null for an item without size. */
export function itemQuad(g: TextGeom, from: number, to: number): Quad | null {
  const [a, b, c, d, e, f] = g.transform
  const len = g.str.length
  const along = Math.hypot(a, b)
  const h = g.height || Math.hypot(c, d)
  if (len === 0 || along === 0 || h === 0) return null
  // Baseline direction, and up perpendicular to it (skew is ignored).
  const ux = a / along
  const uy = b / along
  const vx = -uy
  const vy = ux
  const s0 = (g.width * from) / len
  const s1 = (g.width * to) / len
  const top = g.ascent * h
  const bottom = (g.ascent - 1) * h
  const pt = (s: number, t: number) => [e + ux * s + vx * t, f + uy * s + vy * t]
  return [...pt(s0, bottom), ...pt(s1, bottom), ...pt(s1, top), ...pt(s0, top)]
}

/** A quad in viewport (CSS pixel) coordinates. */
export function quadToViewport(q: Quad, viewport: Pick<PageViewport, 'convertToViewportPoint'>): number[] {
  const out: number[] = []
  for (let i = 0; i < 8; i += 2) out.push(...viewport.convertToViewportPoint(q[i], q[i + 1]))
  return out
}

/** Axis-aligned bounds of viewport quads. */
export function quadsBounds(quads: readonly number[][]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const q of quads) {
    for (let i = 0; i < q.length; i += 2) {
      left = Math.min(left, q[i])
      right = Math.max(right, q[i])
      top = Math.min(top, q[i + 1])
      bottom = Math.max(bottom, q[i + 1])
    }
  }
  return { left, top, right, bottom }
}

/**
 * Scroll position that shows a box (content coordinates): unchanged on an
 * axis where it is already fully in view, otherwise the box goes a third of
 * the way down (and is centred horizontally).
 */
export function revealScroll(
  box: { left: number; top: number; right: number; bottom: number },
  view: { top: number; left: number; width: number; height: number },
): { top: number; left: number } {
  const fitsY = box.top >= view.top && box.bottom <= view.top + view.height
  const fitsX = box.left >= view.left && box.right <= view.left + view.width
  return {
    top: fitsY ? view.top : Math.max(0, box.top - view.height / 3),
    left: fitsX ? view.left : Math.max(0, (box.left + box.right) / 2 - view.width / 2),
  }
}

/** What the viewer highlights: the hits per page (0-based) and the current one. */
export interface SearchView {
  byPage: ReadonlyMap<number, readonly SearchHit[]>
  current: SearchHit | null
}
