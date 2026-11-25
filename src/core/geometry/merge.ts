import type { Annotation, HighlightAnnotation, InkAnnotation, Point, Quad, RGB, TextMarkupAnnotation } from '../session/model'
import { distToSegment } from './hit'
import { mergeLineRects, rectsJoinable, type ScreenRect } from './quads'

/**
 * Merge rules for overlapping highlights of one colour, so an area is never
 * darkened twice: text highlights whose quads overlap or touch, and marker
 * strokes whose painted bands overlap or touch, become one annotation.
 */

/** Quads closer than this (pt) count as touching. */
export const HIGHLIGHT_TOUCH_PT = 1
/** Quads whose line centres are at most this far apart (pt) are on the same line. */
export const HIGHLIGHT_LINE_TOLERANCE_PT = 2
/**
 * Same-line quads join only if their heights differ by at most this fraction
 * of the taller one: a tall and a short quad must not union into a box that
 * covers unhighlighted height.
 */
export const HIGHLIGHT_HEIGHT_RATIO = 0.3
/**
 * Maximum horizontal gap between two same-line quads to bridge as a normal
 * word space, expressed as a fraction of the shorter quad's height.
 */
export const HIGHLIGHT_WORD_GAP_RATIO = 0.6

const wordGap = (a: ScreenRect, b: ScreenRect) =>
  Math.max(HIGHLIGHT_TOUCH_PT, HIGHLIGHT_WORD_GAP_RATIO * Math.min(a.bottom - a.top, b.bottom - b.top))

const byte = (c: number) => Math.round(c * 255)
/** Same colour at 8-bit precision. */
export const sameColor = (a: RGB, b: RGB): boolean => a.every((c, i) => byte(c) === byte(b[i]))
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3

type Box = [number, number, number, number]

function boxOf(points: number[]): Box {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    x1 = Math.min(x1, points[i])
    x2 = Math.max(x2, points[i])
    y1 = Math.min(y1, points[i + 1])
    y2 = Math.max(y2, points[i + 1])
  }
  return [x1, y1, x2, y2]
}

const boxesTouch = (a: Box, b: Box, tol: number) =>
  a[0] - tol <= b[2] && b[0] - tol <= a[2] && a[1] - tol <= b[3] && b[1] - tol <= a[3]

/**
 * A quad in its line frame: `along` is the PDF axis the text runs on, and
 * the frame coordinates are signed so that TL is the frame's (left, top) on
 * every page rotation. Null for quads that are not axis-aligned rectangles.
 */
interface Framed {
  key: string
  axis: 0 | 1
  su: number
  sv: number
  rect: ScreenRect
}

const EPS = 1e-3

function frame(q: Quad): Framed | null {
  const [tlx, tly, trx, try_, blx, bly, brx, bry] = q
  const axis: 0 | 1 = Math.abs(trx - tlx) >= Math.abs(try_ - tly) ? 0 : 1
  const tl = [tlx, tly]
  const tr = [trx, try_]
  const bl = [blx, bly]
  const br = [brx, bry]
  const cross = axis === 0 ? 1 : 0
  // Axis-aligned rectangle: TL-TR and BL-BR run along the axis, TL-BL and TR-BR across it.
  const aligned =
    Math.abs(tl[cross] - tr[cross]) <= EPS &&
    Math.abs(bl[cross] - br[cross]) <= EPS &&
    Math.abs(tl[axis] - bl[axis]) <= EPS &&
    Math.abs(tr[axis] - br[axis]) <= EPS
  if (!aligned) return null
  const su = tr[axis] >= tl[axis] ? 1 : -1
  const sv = bl[cross] >= tl[cross] ? 1 : -1
  const a = [tl[axis] * su, tr[axis] * su]
  const c = [tl[cross] * sv, bl[cross] * sv]
  return {
    key: `${axis}${su}${sv}`,
    axis,
    su,
    sv,
    rect: { left: Math.min(...a), right: Math.max(...a), top: Math.min(...c), bottom: Math.max(...c) },
  }
}

function unframe(f: Omit<Framed, 'rect' | 'key'>, r: ScreenRect): Quad {
  const point = (along: number, across: number): Point => {
    const a = along * f.su
    const c = across * f.sv
    return f.axis === 0 ? [a, c] : [c, a]
  }
  const tl = point(r.left, r.top)
  const tr = point(r.right, r.top)
  const bl = point(r.left, r.bottom)
  const br = point(r.right, r.bottom)
  return [tl[0], tl[1], tr[0], tr[1], bl[0], bl[1], br[0], br[1]]
}

/**
 * Merges quads that overlap, touch, or sit one word space apart on the same
 * line into one quad, with the rectsToQuads rules in PDF space: line centres
 * within HIGHLIGHT_LINE_TOLERANCE_PT, gap <= max(HIGHLIGHT_TOUCH_PT,
 * HIGHLIGHT_WORD_GAP_RATIO * shorter height), heights within
 * HIGHLIGHT_HEIGHT_RATIO. Only axis-aligned quads of the same orientation
 * merge (upright text on any page rotation); other quads are kept unchanged
 * after the merged ones.
 */
export function mergeHighlightQuads(quads: Quad[]): Quad[] {
  const groups = new Map<string, { f: Framed; rects: ScreenRect[] }>()
  const other: Quad[] = []
  for (const q of quads) {
    const f = frame(q)
    if (!f) {
      other.push(q)
      continue
    }
    const g = groups.get(f.key)
    if (g) g.rects.push(f.rect)
    else groups.set(f.key, { f, rects: [f.rect] })
  }
  const out: Quad[] = []
  for (const { f, rects } of groups.values()) {
    for (const r of mergeLineRects(rects, HIGHLIGHT_LINE_TOLERANCE_PT, wordGap, HIGHLIGHT_HEIGHT_RATIO)) out.push(unframe(f, r))
  }
  return [...out, ...other]
}

/**
 * The connected group of `candidates` around `fresh`: candidates that touch
 * `fresh` or, transitively, any candidate already in the group. Kept in the
 * order of `candidates` (z-order).
 */
function connected<T>(fresh: T, candidates: T[], touch: (a: T, b: T) => boolean): T[] {
  const group: T[] = [fresh]
  const inGroup = new Set<T>()
  for (let i = 0; i < group.length; i++) {
    for (const c of candidates) {
      if (!inGroup.has(c) && touch(group[i], c)) {
        inGroup.add(c)
        group.push(c)
      }
    }
  }
  return candidates.filter((c) => inGroup.has(c))
}

function quadsTouch(a: TextMarkupAnnotation, b: TextMarkupAnnotation): boolean {
  const prepA = a.quads.map((q) => ({ box: boxOf(q), framed: frame(q) }))
  return b.quads.some((q) => {
    const boxB = boxOf(q)
    const framedB = frame(q)
    return prepA.some(
      (pa) =>
        boxesTouch(pa.box, boxB, HIGHLIGHT_TOUCH_PT) ||
        (pa.framed !== null &&
          framedB !== null &&
          pa.framed.key === framedB.key &&
          rectsJoinable(pa.framed.rect, framedB.rect, HIGHLIGHT_LINE_TOLERANCE_PT, wordGap, HIGHLIGHT_HEIGHT_RATIO)),
    )
  })
}

export const isTextMarkup = (a: Annotation): a is TextMarkupAnnotation =>
  a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout'

/** Blend of a highlight (absent = multiply). */
const blendOf = (a: HighlightAnnotation): 'normal' | 'multiply' => a.blend ?? 'multiply'

/** Same look: kind and colour, and for highlights opacity and blend. */
export function sameStyle(a: TextMarkupAnnotation, b: TextMarkupAnnotation): boolean {
  if (a.kind !== b.kind || !sameColor(a.color, b.color)) return false
  if (a.kind !== 'highlight') return true
  const h = b as typeof a
  return close(a.opacity, h.opacity) && blendOf(a) === blendOf(h)
}

/**
 * Text markup among `pageAnnotations` (z-order) that `fresh` merges with:
 * same page, kind and colour (highlights: and opacity), connected to `fresh`
 * through quads whose bounding boxes overlap or touch (within
 * HIGHLIGHT_TOUCH_PT), directly or via other such annotations (new touches A,
 * A touches C: both merge). Highlights merge so no area is darkened twice;
 * underlines and strike-outs so text marked twice stays one annotation.
 */
export function findMergeableTextMarkup<T extends TextMarkupAnnotation>(
  pageAnnotations: readonly Annotation[],
  fresh: T,
): T[] {
  const candidates = pageAnnotations.filter(
    (a): a is T => isTextMarkup(a) && a.id !== fresh.id && a.page === fresh.page && sameStyle(a, fresh),
  )
  return connected(fresh, candidates, quadsTouch)
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Distance between segments a-b and c-d (0 when they cross). */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b))
}

/** Segments of a stroke; a single point is a zero-length segment. */
function segments(s: Point[]): [Point, Point][] {
  if (s.length === 1) return [[s[0], s[0]]]
  const out: [Point, Point][] = []
  for (let i = 1; i < s.length; i++) out.push([s[i - 1], s[i]])
  return out
}

/** Whether some point of stroke `a` is within `dist` of stroke `b`. */
export function strokesWithin(a: Point[], b: Point[], dist: number): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (!boxesTouch(boxOf(a.flat()), boxOf(b.flat()), dist)) return false
  const sb = segments(b)
  return segments(a).some(([p, q]) => sb.some(([r, s]) => segmentDistance(p, q, r, s) <= dist + 1e-9))
}

/**
 * Marker annotations among `pageAnnotations` (z-order) that the marker
 * stroke(s) of `fresh` merge with: same page, colour, opacity, width and
 * blend, connected to `fresh` through strokes within `width` of each other
 * (the painted bands overlap or touch), directly or via other such marker
 * annotations. Pen ink never merges.
 */
export function findMergeableMarkerStrokes(
  pageAnnotations: readonly Annotation[],
  fresh: InkAnnotation,
): InkAnnotation[] {
  if (fresh.role !== 'marker') return []
  const candidates = pageAnnotations.filter(
    (a): a is InkAnnotation =>
      a.kind === 'ink' &&
      a.role === 'marker' &&
      a.id !== fresh.id &&
      a.page === fresh.page &&
      a.blend === fresh.blend &&
      sameColor(a.color, fresh.color) &&
      close(a.opacity, fresh.opacity) &&
      close(a.width, fresh.width),
  )
  const touch = (a: InkAnnotation, b: InkAnnotation) =>
    a.strokes.some((s) => b.strokes.some((t) => strokesWithin(s, t, fresh.width)))
  return connected(fresh, candidates, touch)
}

/** Pieces of a quad narrower than this (pt) left over by a cut are dropped. */
export const CUT_MIN_WIDTH_PT = 0.5

/** Same line: the vertical overlap is at least this fraction of the lower rect's height. */
const CUT_LINE_OVERLAP = 0.5

const sameLine = (a: ScreenRect, b: ScreenRect) =>
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >=
  CUT_LINE_OVERLAP * Math.min(a.bottom - a.top, b.bottom - b.top)

/**
 * `quads` with the parts under `cuts` removed (unmarking selected text):
 * on each line, the cut's extent along the text is taken out of the quads of
 * the same orientation (a quad may split in two); pieces narrower than
 * CUT_MIN_WIDTH_PT are dropped. Quads that are not axis-aligned cannot be
 * cut partly: any cut touching one removes it whole.
 */
export function cutQuads(quads: Quad[], cuts: Quad[]): Quad[] {
  return cutQuadGroups(quads, cuts).flat()
}

/**
 * cutQuads, with what is left split into contiguous pieces: `quads` are
 * read in their order (reading order: line by line, start to end), and a
 * piece ends wherever a cut took text out (a quad split in two, a line's
 * start or end cut off, a quad removed whole). Untouched quads stay with
 * their neighbours, so a cut in the middle of a three-line marking leaves
 * two multi-line pieces and trimming its start or end leaves one. Quads no
 * cut changes are returned as the same objects. Empty when nothing is left.
 */
export function cutQuadGroups(quads: Quad[], cuts: Quad[]): Quad[][] {
  const framedCuts = cuts.map((c) => frame(c)).filter((f): f is Framed => f !== null)
  const cutBoxes = cuts.map((c) => boxOf(c))
  const groups: Quad[][] = []
  let current: Quad[] = []
  /** A cut point: what follows is another piece. */
  const split = () => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const q of quads) {
    const f = frame(q)
    if (!f) {
      const box = boxOf(q)
      if (cutBoxes.some((c) => boxesTouch(c, box, 0))) split()
      else current.push(q)
      continue
    }
    let pieces: [number, number][] = [[f.rect.left, f.rect.right]]
    for (const c of framedCuts) {
      if (c.key !== f.key || !sameLine(c.rect, f.rect)) continue
      pieces = pieces.flatMap(([l, r]): [number, number][] => {
        if (c.rect.right <= l || c.rect.left >= r) return [[l, r]]
        const kept: [number, number][] = []
        if (c.rect.left > l) kept.push([l, c.rect.left])
        if (c.rect.right < r) kept.push([c.rect.right, r])
        return kept
      })
    }
    if (pieces.length === 1 && pieces[0][0] === f.rect.left && pieces[0][1] === f.rect.right) {
      current.push(q)
      continue
    }
    // The line's start was cut off (or all of it): the piece before ends here.
    if (pieces.length === 0 || pieces[0][0] > f.rect.left) split()
    pieces.forEach(([l, r], i) => {
      if (i > 0) split()
      if (r - l >= CUT_MIN_WIDTH_PT) current.push(unframe(f, { ...f.rect, left: l, right: r }))
    })
    // Its end was cut off: the next line starts another piece.
    if (pieces.length > 0 && pieces[pieces.length - 1][1] < f.rect.right) split()
  }
  split()
  return groups
}
