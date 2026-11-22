import type { AnnotationKind } from '../../core/registry/annotationKinds'
import type { Point, Rect, ShapeAnnotation } from '../../core/session/model'
import { rotatedBounds } from '../../core/geometry/rotation'
import { turnBox, turnOf, unturned } from '../turnedBox'
import Render from './Render.svelte'

const halfWidth = (a: ShapeAnnotation): number => (a.border ? a.border.width / 2 : 0)

/** Whether `p` lies in the ellipse centred at `c` with radii `rx`, `ry` (empty for non-positive radii). */
function inEllipse([x, y]: Point, [cx, cy]: Point, rx: number, ry: number): boolean {
  if (rx <= 0 || ry <= 0) return false
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}

/** Whether `p` lies in `r` grown by `d` on every side (empty when shrunk past zero). */
function inRectGrown([x, y]: Point, r: Rect, d: number): boolean {
  return r[2] - r[0] + 2 * d > 0 && r[3] - r[1] + 2 * d > 0
    && x >= r[0] - d && x <= r[2] + d && y >= r[1] - d && y <= r[3] + d
}

/**
 * A filled shape is hit anywhere inside its outline (stroke included); an
 * outline-only one within half the border width plus the tolerance of the
 * outline: between the outline grown and shrunk by that distance (for
 * ellipses, the ellipses with radii grown and shrunk by it).
 */
function hitTest(a: ShapeAnnotation, pdf: Point, tolerancePt: number): boolean {
  const p = unturned(a, pdf)
  const t = halfWidth(a) + tolerancePt
  const r = a.rect
  if (a.shape === 'rect') {
    if (!inRectGrown(p, r, t)) return false
    return a.fill !== null || !inRectGrown(p, r, -t)
  }
  const c: Point = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]
  const rx = (r[2] - r[0]) / 2
  const ry = (r[3] - r[1]) / 2
  if (!inEllipse(p, c, rx + t, ry + t)) return false
  return a.fill !== null || !inEllipse(p, c, rx - t, ry - t)
}

export const shapeKind: AnnotationKind<ShapeAnnotation> = {
  kind: 'shape',
  Render,
  bounds(a) {
    const h = halfWidth(a)
    return rotatedBounds([a.rect[0] - h, a.rect[1] - h, a.rect[2] + h, a.rect[3] + h], turnOf(a))
  },
  hitTest,
  translate: (a, dx, dy) => ({
    ...a,
    rect: [a.rect[0] + dx, a.rect[1] + dy, a.rect[2] + dx, a.rect[3] + dy],
  }),
  scale(a, from, to) {
    const sx = from[2] === from[0] ? 1 : (to[2] - to[0]) / (from[2] - from[0])
    const sy = from[3] === from[1] ? 1 : (to[3] - to[1]) / (from[3] - from[1])
    const x = (v: number) => to[0] + (v - from[0]) * sx
    const y = (v: number) => to[1] + (v - from[1]) * sy
    const [x1, x2] = [x(a.rect[0]), x(a.rect[2])]
    const [y1, y2] = [y(a.rect[1]), y(a.rect[3])]
    return { ...a, rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] }
  },
  rotate: turnBox,
}
