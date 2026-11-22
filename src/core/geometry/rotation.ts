import type { Point, Rect } from '../session/model'

/**
 * Rotation of annotations. Angles are degrees, counter-clockwise in PDF user
 * space (y up), which is also counter-clockwise on screen for every page
 * /Rotate (a page rotation turns the view, it never mirrors it).
 */

/** Rotation steps (degrees) the rotate handle snaps to while Shift is held. */
export const ROTATION_SNAP = 15

/** `deg` in (-180, 180]; tiny residues of floating-point sums become 0. */
export function normalizeAngle(deg: number): number {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return Math.abs(d) < 1e-9 ? 0 : d
}

/** `deg` rounded to the nearest multiple of `step`. */
export function snapAngle(deg: number, step = ROTATION_SNAP): number {
  return normalizeAngle(Math.round(deg / step) * step)
}

/** `p` turned by `deg` counter-clockwise around `c` (PDF space, y up). */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (deg === 0) return p
  const t = (deg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]
}

/**
 * `p` turned by `deg` counter-clockwise as seen on screen around `c`, in
 * screen coordinates (y down): the same turn as rotatePoint makes in PDF space.
 */
export function rotateScreenPoint(p: Point, c: Point, deg: number): Point {
  return rotatePoint(p, c, -deg)
}

export const rectCentre = (r: Rect): Point => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]

/** The corners of `r` turned by `deg` around its centre: bottom-left, bottom-right, top-right, top-left (PDF). */
export function rotatedCorners(r: Rect, deg: number): Point[] {
  const c = rectCentre(r)
  const corners: Point[] = [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ]
  return corners.map((p) => rotatePoint(p, c, deg))
}

/** Bounding box of `r` turned by `deg` around its centre. */
export function rotatedBounds(r: Rect, deg: number): Rect {
  if (deg === 0) return r
  const pts = rotatedCorners(r, deg)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The shift that keeps an annotation turned by `deg` around its rect's
 * centre in place when that rect changes from `before` to `after` (both
 * unturned, in the frame of `before`): resizing or re-wrapping moves the
 * centre, which the turn pivots on, so without it the anchored edge or
 * corner would wander. Zero when not turned.
 */
export function reanchorShift(before: Rect, after: Rect, deg: number): Point {
  if (deg === 0) return [0, 0]
  const c0 = rectCentre(before)
  const c1 = rectCentre(after)
  const turned = rotatePoint(c1, c0, deg)
  return [turned[0] - c1[0], turned[1] - c1[1]]
}

/** Visual (screen) angle (degrees, counter-clockwise) of `p` around `c`, both in screen coordinates (y down). */
export function screenAngle(p: Point, c: Point): number {
  return (Math.atan2(-(p[1] - c[1]), p[0] - c[0]) * 180) / Math.PI
}
