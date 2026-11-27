import type { InkAnnotation, Point } from '../session/model'
import { maxInkWidth } from './pressure'

/** A piece of a cut stroke: its points and, when the stroke had them, its pressures. */
export interface StrokePiece {
  points: Point[]
  pressure?: number[]
}

/**
 * The part of segment a→b (as 0..1 along it) strictly inside the circle
 * around `c` with radius `r`; null when it does not enter the circle (a
 * tangent touch does not count).
 */
function insideInterval(a: Point, b: Point, c: Point, r: number): [number, number] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const fx = a[0] - c[0]
  const fy = a[1] - c[1]
  const qa = dx * dx + dy * dy
  const qc = fx * fx + fy * fy - r * r
  if (qa === 0) return qc < 0 ? [0, 1] : null
  const qb = 2 * (fx * dx + fy * dy)
  const disc = qb * qb - 4 * qa * qc
  if (disc <= 0) return null
  const sq = Math.sqrt(disc)
  const t0 = Math.max(0, (-qb - sq) / (2 * qa))
  const t1 = Math.min(1, (-qb + sq) / (2 * qa))
  return t1 - t0 > 1e-9 ? [t0, t1] : null
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function length(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return len
}

/**
 * Cuts out of the polyline `points` everything within `r` of `c` (the
 * eraser): segments crossing the circle end exactly on it, and the stroke
 * falls apart into the pieces left outside. Pressures (one per point, when
 * given and matching) are split with the points and interpolated at the
 * cuts. Pieces shorter than `minLength` are dropped, so a cut leaves no
 * specks. Null when the circle does not touch the stroke (it stays as is);
 * an empty list when nothing is left of it.
 */
export function cutStroke(points: Point[], pressure: number[] | undefined, c: Point, r: number, minLength = 0): StrokePiece[] | null {
  if (points.length === 0) return null
  const ps = pressure && pressure.length === points.length ? pressure : undefined
  if (points.length === 1) return Math.hypot(points[0][0] - c[0], points[0][1] - c[1]) < r ? [] : null
  // Cheap reject: the stroke's box does not reach the circle.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const [x, y] of points) {
    if (x < x1) x1 = x
    if (x > x2) x2 = x
    if (y < y1) y1 = y
    if (y > y2) y2 = y
  }
  if (c[0] < x1 - r || c[0] > x2 + r || c[1] < y1 - r || c[1] > y2 + r) return null

  const pieces: StrokePiece[] = []
  let touched = false
  let cur: StrokePiece | null = null
  const start = (p: Point, pr: number | undefined): StrokePiece => (ps ? { points: [p], pressure: [pr!] } : { points: [p] })
  const push = (piece: StrokePiece, p: Point, pr: number | undefined) => {
    piece.points.push(p)
    if (ps) piece.pressure!.push(pr!)
  }
  const finish = () => {
    if (cur && cur.points.length > 1 && length(cur.points) >= minLength) pieces.push(cur)
    cur = null
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const pa = ps?.[i]
    const pb = ps?.[i + 1]
    const prAt = (t: number) => (ps ? pa! + (pb! - pa!) * t : undefined)
    if (i === 0 && !(Math.hypot(a[0] - c[0], a[1] - c[1]) < r)) cur = start(a, pa)
    const cut = insideInterval(a, b, c, r)
    if (!cut) {
      cur ??= start(a, pa)
      push(cur, b, pb)
      continue
    }
    touched = true
    const [t0, t1] = cut
    if (t0 > 0) {
      cur ??= start(a, pa)
      push(cur, lerp(a, b, t0), prAt(t0))
    }
    finish()
    if (t1 < 1) {
      cur = start(lerp(a, b, t1), prAt(t1))
      push(cur, b, pb)
    }
  }
  finish()
  return touched ? pieces : null
}

/** Box of an annotation's points and half its widest width, cached per object (annotations are immutable). */
const boxes = new WeakMap<InkAnnotation, [number, number, number, number, number]>()

function inkBox(a: InkAnnotation): [number, number, number, number, number] {
  let box = boxes.get(a)
  if (!box) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const s of a.strokes) {
      for (const [x, y] of s) {
        if (x < x1) x1 = x
        if (x > x2) x2 = x
        if (y < y1) y1 = y
        if (y > y2) y2 = y
      }
    }
    box = [x1, y1, x2, y2, maxInkWidth(a) / 2]
    boxes.set(a, box)
  }
  return box
}

/**
 * `a` with the eraser (circle around `c`, radius `r` in PDF units) cut out
 * of its strokes: the cut reaches half the stroke width further, so the
 * round caps of the pieces end at the eraser's edge. Undefined when the
 * eraser misses every stroke; an annotation with no strokes when nothing is
 * left. Pressure arrays stay parallel to the strokes.
 */
export function cutInk(a: InkAnnotation, c: Point, r: number, minLength = 0): InkAnnotation | undefined {
  const [x1, y1, x2, y2, halfWidth] = inkBox(a)
  const reach = r + halfWidth
  // Most annotations on the page are nowhere near the eraser: reject them without allocating.
  if (c[0] < x1 - reach || c[0] > x2 + reach || c[1] < y1 - reach || c[1] > y2 + reach) return undefined
  let changed = false
  const strokes: Point[][] = []
  const pressure: number[][] = []
  a.strokes.forEach((s, i) => {
    const ps = a.pressure?.[i]
    const pieces = cutStroke(s, ps, c, reach, minLength)
    if (!pieces) {
      strokes.push(s)
      if (a.pressure) pressure.push(ps ?? [])
      return
    }
    changed = true
    for (const piece of pieces) {
      strokes.push(piece.points)
      // A stroke whose pressures did not match keeps not matching (drawn at the set width).
      if (a.pressure) pressure.push(piece.pressure ?? [])
    }
  })
  if (!changed) return undefined
  return a.pressure ? { ...a, strokes, pressure } : { ...a, strokes }
}
