import { annotationKinds } from '../../core/registry/annotationKinds'
import { normalizeAngle, screenAngle, snapAngle } from '../../core/geometry/rotation'
import type { Annotation, Point } from '../../core/session/model'

/**
 * The turn (degrees, counter-clockwise) of a rotate-handle drag around the
 * screen point `centre`, from the press at `from` to the pointer at `to`
 * (screen px). With `snap` (Shift) the resulting angle `base + turn` lands
 * on a multiple of ROTATION_SNAP: `base` is the turn the selection already
 * has (a box's own rotation; 0 for points and groups, whose turn snaps).
 */
export function dragTurn(centre: Point, from: Point, to: Point, snap: boolean, base = 0): number {
  const turn = normalizeAngle(screenAngle(to, centre) - screenAngle(from, centre))
  return snap ? normalizeAngle(snapAngle(base + turn) - base) : turn
}

/** `list` turned by `deg` around `centre` (PDF), stamped `modifiedAt`; kinds that cannot turn stay as they are. */
export function turnAll(list: readonly Annotation[], centre: Point, deg: number, modifiedAt: string): Annotation[] {
  return list.map((a) => {
    const rotate = annotationKinds.get(a.kind).rotate
    return rotate ? { ...rotate(a, centre, deg), modifiedAt } : a
  })
}
