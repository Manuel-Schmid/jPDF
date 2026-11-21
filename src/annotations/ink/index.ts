import type { AnnotationKind } from '../../core/registry/annotationKinds'
import type { InkAnnotation, Point } from '../../core/session/model'
import { maxInkWidth } from '../../core/geometry/pressure'
import Render from './Render.svelte'

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  // Single points and zero-length segments: distance to the point.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function mapPoints(a: InkAnnotation, f: (p: Point) => Point): InkAnnotation {
  return { ...a, strokes: a.strokes.map((s) => s.map(f)) }
}

export const inkKind: AnnotationKind<InkAnnotation> = {
  kind: 'ink',
  Render,
  bounds(a) {
    const pts = a.strokes.flat()
    if (pts.length === 0) return [0, 0, 0, 0]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const h = maxInkWidth(a) / 2
    return [Math.min(...xs) - h, Math.min(...ys) - h, Math.max(...xs) + h, Math.max(...ys) + h]
  },
  hitTest(a, p, tolerancePt) {
    const r = maxInkWidth(a) / 2 + tolerancePt
    return a.strokes.some((s) =>
      s.length === 1 ? segDist(p, s[0], s[0]) <= r : s.some((q, i) => i > 0 && segDist(p, s[i - 1], q) <= r),
    )
  },
  translate: (a, dx, dy) => mapPoints(a, ([x, y]) => [x + dx, y + dy]),
  scale(a, from, to) {
    const sx = from[2] === from[0] ? 1 : (to[2] - to[0]) / (from[2] - from[0])
    const sy = from[3] === from[1] ? 1 : (to[3] - to[1]) / (from[3] - from[1])
    return mapPoints(a, ([x, y]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy])
  },
}
