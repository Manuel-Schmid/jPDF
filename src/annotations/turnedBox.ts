import { normalizeAngle, rectCentre, rotatePoint } from '../core/geometry/rotation'
import type { Point, Rect, Rotatable } from '../core/session/model'

/** A box-shaped annotation (text box, shape, image): a rect, maybe turned around its centre. */
type TurnedBox = Rotatable & { rect: Rect }

/** The annotation's turn (degrees, counter-clockwise); 0 when not turned. */
export const turnOf = (a: Rotatable): number => a.rotation ?? 0

/** `a` with the turn `deg` (normalised); the field is left out when not turned, as the reader does. */
export function withTurn<A extends Rotatable>(a: A, deg: number): A {
  const r = normalizeAngle(deg)
  if (r !== 0) return { ...a, rotation: r }
  if (a.rotation === undefined) return a
  const rest = { ...a }
  delete rest.rotation
  return rest
}

/** `p` (PDF) in the unturned frame of `a`: turned back around the rect's centre. */
export function unturned(a: TurnedBox, p: Point): Point {
  const deg = turnOf(a)
  return deg === 0 ? p : rotatePoint(p, rectCentre(a.rect), -deg)
}

/** `a` turned by `deg` around `centre`: its rect's centre moves along, its own turn adds up. */
export function turnBox<A extends TurnedBox>(a: A, centre: Point, deg: number): A {
  const c = rectCentre(a.rect)
  const [x, y] = rotatePoint(c, centre, deg)
  const dx = x - c[0]
  const dy = y - c[1]
  const rect: Rect = [a.rect[0] + dx, a.rect[1] + dy, a.rect[2] + dx, a.rect[3] + dy]
  return withTurn({ ...a, rect }, turnOf(a) + deg)
}
