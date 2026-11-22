import type { AnnotationKind } from '../../core/registry/annotationKinds'
import { arrowHead, pointsBox } from '../../core/geometry/arrow'
import { distToSegment } from '../../core/geometry/hit'
import { rotatePoint } from '../../core/geometry/rotation'
import type { LineAnnotation, Point } from '../../core/session/model'
import Render from './Render.svelte'

/** The segments drawn: the line's, then the arrowhead's two wings. */
function segments(a: LineAnnotation): [Point, Point][] {
  const out: [Point, Point][] = []
  for (let i = 1; i < a.points.length; i++) out.push([a.points[i - 1], a.points[i]])
  const head = a.arrow ? arrowHead(a.points, a.border.width) : null
  if (head) out.push([head[0], head[1]], [head[2], head[1]])
  return out
}

function mapPoints(a: LineAnnotation, f: (p: Point) => Point): LineAnnotation {
  return { ...a, points: a.points.map(f) }
}

export const lineKind: AnnotationKind<LineAnnotation> = {
  kind: 'line',
  Render,
  bounds(a) {
    const head = a.arrow ? arrowHead(a.points, a.border.width) : null
    const [x1, y1, x2, y2] = pointsBox(head ? [...a.points, head[0], head[2]] : a.points)
    const h = a.border.width / 2
    return [x1 - h, y1 - h, x2 + h, y2 + h]
  },
  hitTest(a, p, tolerancePt) {
    const r = a.border.width / 2 + tolerancePt
    return segments(a).some(([s, e]) => distToSegment(p, s, e) <= r)
  },
  translate: (a, dx, dy) => mapPoints(a, ([x, y]) => [x + dx, y + dy]),
  scaleFrame: (a) => pointsBox(a.points),
  scale(a, from, to) {
    const sx = from[2] === from[0] ? 1 : (to[2] - to[0]) / (from[2] - from[0])
    const sy = from[3] === from[1] ? 1 : (to[3] - to[1]) / (from[3] - from[1])
    return mapPoints(a, ([x, y]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy])
  },
  // The arrowhead follows from the points.
  rotate: (a, c, deg) => mapPoints(a, (p) => rotatePoint(p, c, deg)),
}
