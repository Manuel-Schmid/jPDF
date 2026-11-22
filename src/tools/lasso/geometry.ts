import { annotationKinds } from '../../core/registry/annotationKinds'
import { rectCentre, rotatedCorners } from '../../core/geometry/rotation'
import type { Annotation, Point, Rect } from '../../core/session/model'

/** Whether `p` lies inside the closed polygon `poly` (even-odd rule; at least 3 points). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Points that stand for the annotation's drawing when lassoing it: the
 * points of its strokes or line, the corners of its text quads, or the
 * corners and centre of its box. (Its bounds alone would let a lasso around
 * the empty middle of a large curved stroke catch it.)
 */
export function samplePoints(a: Annotation): Point[] {
  switch (a.kind) {
    case 'ink':
      return a.strokes.flat()
    case 'line':
      return a.points
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return a.quads.flatMap((q) => [
        [q[0], q[1]],
        [q[2], q[3]],
        [q[4], q[5]],
        [q[6], q[7]],
      ] as Point[])
    case 'freetext':
    case 'shape':
    case 'image':
      // The turned box's own corners (its bounds stick out past them).
      return [...rotatedCorners(a.rect, a.rotation ?? 0), rectCentre(a.rect)]
  }
}

/**
 * The annotations of `list` the lasso `poly` (PDF space) catches: those with
 * more than half of their sample points inside it, in `list` order. A lasso
 * of fewer than 3 points catches nothing.
 */
export function lassoed(list: readonly Annotation[], poly: readonly Point[]): Annotation[] {
  if (poly.length < 3) return []
  return list.filter((a) => {
    const pts = samplePoints(a)
    if (pts.length === 0) return false
    const inside = pts.filter((p) => pointInPolygon(p, poly)).length
    return inside * 2 > pts.length
  })
}

/** The union of the annotations' bounds (PDF space); null for none. */
export function groupBounds(list: readonly Annotation[]): Rect | null {
  let r: Rect | null = null
  for (const a of list) {
    const b = annotationKinds.get(a.kind).bounds(a)
    r = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] : b
  }
  return r
}
