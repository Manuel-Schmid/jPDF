import { describe, expect, it } from 'vitest'
import {
  normalizeAngle, reanchorShift, rotatedBounds, rotatedCorners, rotatePoint, rotateScreenPoint, screenAngle, snapAngle,
} from '../../../src/core/geometry/rotation'
import type { Point } from '../../../src/core/session/model'

const close = (p: readonly number[], q: readonly number[]) => p.forEach((v, i) => expect(v).toBeCloseTo(q[i], 9))

describe('rotation geometry', () => {
  it('normalises angles to (-180, 180]', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(190)).toBe(-170)
    expect(normalizeAngle(-180)).toBe(180)
    expect(normalizeAngle(540)).toBe(180)
    expect(normalizeAngle(-370)).toBe(-10)
    expect(normalizeAngle(1e-12)).toBe(0)
  })

  it('snaps to 15 degree steps', () => {
    expect(snapAngle(7)).toBe(0)
    expect(snapAngle(8)).toBe(15)
    expect(snapAngle(-52)).toBe(-45)
    expect(snapAngle(178)).toBe(180)
  })

  it('turns points counter-clockwise in PDF space', () => {
    close(rotatePoint([2, 1], [1, 1], 90), [1, 2])
    close(rotatePoint([2, 1], [1, 1], -90), [1, 0])
    expect(rotatePoint([5, 6], [0, 0], 0)).toEqual([5, 6])
  })

  it('turns screen points counter-clockwise as seen (y down)', () => {
    // Right of the centre → above it on screen.
    close(rotateScreenPoint([2, 1], [1, 1], 90), [1, 0])
    expect(screenAngle([1, 0], [1, 1])).toBeCloseTo(90)
    expect(screenAngle([2, 1], [1, 1])).toBeCloseTo(0)
  })

  it('gives the corners and bounds of a turned rect', () => {
    close(rotatedCorners([0, 0, 4, 2], 90).flat(), [3, -1, 3, 3, 1, 3, 1, -1])
    close(rotatedBounds([0, 0, 4, 2], 90), [1, -1, 3, 3])
    const d = Math.SQRT2
    close(rotatedBounds([-1, -1, 1, 1], 45), [-d, -d, d, d])
    expect(rotatedBounds([0, 0, 4, 2], 0)).toEqual([0, 0, 4, 2])
  })

  it('reanchors a resized turned rect so its untouched corner stays put', () => {
    const before = [0, 0, 4, 2] as const
    // Grown to the right and down (top-left corner kept in the unturned frame).
    const after = [0, -2, 8, 2] as const
    const [dx, dy] = reanchorShift([...before], [...after], 90)
    const placed = [after[0] + dx, after[1] + dy, after[2] + dx, after[3] + dy] as const
    // The top-left corner, turned, is where it was.
    const corner = (r: readonly number[]) => rotatePoint([r[0], r[3]], [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], 90) as Point
    close(corner(placed), corner(before))
    expect(reanchorShift([...before], [...after], 0)).toEqual([0, 0])
  })
})
