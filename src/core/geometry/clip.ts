import type { Point } from '../session/model'

/** An axis-aligned box `[x1, y1, x2, y2]` in PDF user space (corners in any order). */
export type Box = [number, number, number, number]

export interface ClippedStrokes {
  strokes: Point[][]
  /** One array per stroke, parallel to `strokes`; null when the input had none. */
  pressure: number[][] | null
}

/**
 * The parts of a polyline inside `box`, as separate strokes: a stroke that
 * leaves the box ends exactly on its edge, and one that comes back starts a
 * new stroke there. Crossing points are interpolated, and so is their
 * pressure, so the cut keeps the stroke's shape and width. Points on the edge
 * count as inside. A single point (a dot) is kept when it is inside.
 */
export function clipPolyline(points: Point[], pressure: number[] | null, box: Box): ClippedStrokes {
  const x1 = Math.min(box[0], box[2])
  const x2 = Math.max(box[0], box[2])
  const y1 = Math.min(box[1], box[3])
  const y2 = Math.max(box[1], box[3])
  const inside = (p: Point) => p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2

  const strokes: Point[][] = []
  const widths: number[][] | null = pressure ? [] : null
  if (points.length === 1) {
    if (inside(points[0])) {
      strokes.push([points[0]])
      widths?.push([pressure![0]])
    }
    return { strokes, pressure: widths }
  }

  let cur: Point[] | null = null
  let curP: number[] | null = null
  const close = () => {
    if (cur) {
      strokes.push(cur)
      if (widths) widths.push(curP!)
    }
    cur = curP = null
  }
  const lerpP = (i: number, t: number) =>
    pressure ? pressure[i] + (pressure[i + 1] - pressure[i]) * t : 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const span = liangBarsky(a, b, x1, y1, x2, y2)
    if (!span) {
      close()
      continue
    }
    const [t0, t1] = span
    const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (!cur || t0 > 0) {
      // Entering the box (or the first segment): a new stroke starts here.
      close()
      cur = [t0 > 0 ? at(t0) : a]
      curP = pressure ? [t0 > 0 ? lerpP(i, t0) : pressure[i]] : null
    }
    cur!.push(t1 < 1 ? at(t1) : b)
    curP?.push(t1 < 1 ? lerpP(i, t1) : pressure![i + 1])
    if (t1 < 1) close()
  }
  close()
  return { strokes, pressure: widths }
}

/**
 * The parameter range [t0, t1] of segment a→b inside the box, or null when
 * it misses it or only touches it in one point (a zero-length piece would
 * be drawn as a dot). A zero-length segment inside the box gives [0, 1].
 */
function liangBarsky(
  a: Point,
  b: Point,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a[0] - x1],
    [dx, x2 - a[0]],
    [-dy, a[1] - y1],
    [dy, y2 - a[1]],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  if (t0 >= t1 && (dx !== 0 || dy !== 0)) return null
  return [t0, t1]
}
