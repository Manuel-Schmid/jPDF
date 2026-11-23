import type { ScreenRect } from '../../core/geometry/quads'

/**
 * Line geometry for dragging out a text selection (see textDrag.ts). Boxes
 * are in a page-local frame where text runs left to right and y grows down
 * (PDF user space with y flipped), so page rotation and scrolling don't matter.
 */

export interface LocalPoint {
  x: number
  y: number
}

/** A text span's box and what it stands for (its text node). */
export interface LineSpan<T> {
  box: ScreenRect
  item: T
}

/** Spans on one line, left to right, and their common box. */
export interface TextLine<T> {
  box: ScreenRect
  spans: LineSpan<T>[]
}

const height = (r: ScreenRect) => r.bottom - r.top

function union(a: ScreenRect, b: ScreenRect): ScreenRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }
}

/** A gap wider than this many line heights splits a line (columns, table cells). */
const MAX_GAP_LINES = 3

/**
 * Whether span `b` continues line `a`: it shares at least half of the
 * smaller height and is not far beside it.
 */
function sameLine(a: ScreenRect, b: ScreenRect): boolean {
  const h = Math.min(height(a), height(b))
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const gap = Math.max(b.left - a.right, a.left - b.right)
  return overlap >= 0.5 * h && gap <= MAX_GAP_LINES * Math.max(height(a), height(b))
}

/**
 * Groups spans (in reading order, as the text layer has them) into lines:
 * consecutive spans that share the line's height without a wide gap.
 */
export function groupLines<T>(spans: LineSpan<T>[]): TextLine<T>[] {
  const lines: TextLine<T>[] = []
  let cur: TextLine<T> | null = null
  for (const s of spans) {
    if (cur && sameLine(cur.box, s.box)) {
      cur.spans.push(s)
      cur.box = union(cur.box, s.box)
    } else {
      cur = { box: s.box, spans: [s] }
      lines.push(cur)
    }
  }
  for (const l of lines) l.spans.sort((a, b) => a.box.left - b.box.left)
  return lines
}

/** Distance from `p` to the box (0 inside). */
export function boxDistance(r: ScreenRect, p: LocalPoint): number {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right)
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom)
  return Math.hypot(dx, dy)
}

/** The line and span nearest to `p`, if one is at most `tolerance` away. */
export function nearestSpan<T>(
  lines: readonly TextLine<T>[],
  p: LocalPoint,
  tolerance: number,
): { line: number; span: LineSpan<T> } | null {
  let best: { line: number; span: LineSpan<T> } | null = null
  let bestD = tolerance
  for (let i = 0; i < lines.length; i++) {
    // Whole lines further away than the best span so far can't hold a nearer one.
    if (boxDistance(lines[i].box, p) > bestD) continue
    for (const s of lines[i].spans) {
      const d = boxDistance(s.box, p)
      if (d < bestD || (best === null && d <= bestD)) {
        best = { line: i, span: s }
        bestD = d
      }
    }
  }
  return best
}

/** How far above/below a line the pointer may stray (share of its height, at least `min`). */
export interface Band {
  ratio: number
  min: number
}

/**
 * The line a drag's focus is on, with the pointer at `p`, when it was on
 * line `current`. It stays there while the pointer is within the band
 * above/below that line (and roughly level with it horizontally); then it
 * moves to the line the pointer is clearly on, else to the nearest line, so
 * dragging past the text stops the selection at its edge instead of losing it.
 */
export function focusLine<T>(
  lines: readonly TextLine<T>[],
  current: number,
  p: LocalPoint,
  band: Band,
): number {
  const cur = lines[current]
  if (cur) {
    const h = height(cur.box)
    const b = Math.max(band.min, band.ratio * h)
    // A pointer far beside the line (another column) is not straying from it.
    const level = p.x >= cur.box.left - h && p.x <= cur.box.right + h
    if (level && p.y >= cur.box.top - b && p.y <= cur.box.bottom + b) return current
  }
  let nearest = current
  let nearestD = Infinity
  for (let i = 0; i < lines.length; i++) {
    const d = boxDistance(lines[i].box, p)
    if (d === 0) return i
    if (d < nearestD) {
      nearest = i
      nearestD = d
    }
  }
  return nearest
}

/**
 * The span of `line` at x: the one under it, the nearer one of a gap, or the
 * first/last when x is before/after the line, with `edge` saying which end
 * of the span that is (null: x is on the span).
 */
export function spanAt<T>(
  line: TextLine<T>,
  x: number,
): { span: LineSpan<T>; edge: 'start' | 'end' | null } {
  const spans = line.spans
  const first = spans[0]
  const last = spans[spans.length - 1]
  if (x <= first.box.left) return { span: first, edge: 'start' }
  if (x >= last.box.right) return { span: last, edge: 'end' }
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]
    if (x >= s.box.left && x <= s.box.right) return { span: s, edge: null }
    const next = spans[i + 1]
    if (next && x > s.box.right && x < next.box.left) {
      return x - s.box.right <= next.box.left - x
        ? { span: s, edge: 'end' }
        : { span: next, edge: 'start' }
    }
  }
  return { span: last, edge: 'end' }
}

/**
 * The caret offset (0..count) nearest to x among `count` characters whose
 * centres `centre(i)` grow left to right: the number of characters whose
 * centre is left of x. Binary search, so log2(count) lookups.
 */
export function caretOffset(count: number, centre: (i: number) => number, x: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (centre(mid) <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}
