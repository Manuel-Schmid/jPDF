import { describe, expect, it } from 'vitest'
import {
  dedupeIndices, inkOutlines, maxInkWidth, outlinePath, pressureWidth, simplifyWithWidths, smoothPressure, strokeOutline,
  strokeWidths, type OutlineOp,
} from '../../../src/core/geometry/pressure'
import { dedupe } from '../../../src/core/geometry/stroke'
import type { InkAnnotation, Point } from '../../../src/core/session/model'

const id = (p: Point): Point => p

const ink = (over: Partial<InkAnnotation> = {}): InkAnnotation => ({
  id: 'a', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
  strokes: [[[0, 0], [10, 0]]], color: [0, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen', ...over,
})

describe('pressureWidth', () => {
  it('draws the set width at medium pressure, thinner and wider around it', () => {
    expect(pressureWidth(2, 0.5)).toBe(2)
    expect(pressureWidth(2, 0)).toBeCloseTo(0.8)
    expect(pressureWidth(2, 1)).toBeCloseTo(3.2)
  })
  it('clamps pressure to 0..1', () => {
    expect(pressureWidth(2, -1)).toBe(pressureWidth(2, 0))
    expect(pressureWidth(2, 3)).toBe(pressureWidth(2, 1))
  })
})

describe('strokeWidths / maxInkWidth', () => {
  it('uses the set width without pressure', () => {
    expect(strokeWidths(ink(), 0)).toEqual([2, 2])
    expect(maxInkWidth(ink())).toBe(2)
  })
  it('follows the pressure per point', () => {
    const a = ink({ pressure: [[0.5, 1]] })
    expect(strokeWidths(a, 0)).toEqual([2, pressureWidth(2, 1)])
    expect(maxInkWidth(a)).toBeCloseTo(3.2)
  })
  it('keeps the set width for a stroke whose pressure does not match its points', () => {
    expect(strokeWidths(ink({ pressure: [[1]] }), 0)).toEqual([2, 2])
  })
})

describe('strokeOutline', () => {
  const points = (ops: OutlineOp[]) => ops.flatMap((o) => (o.op === 'Z' ? [] : [o.p]))

  it('outlines a straight stroke clockwise: left edge, end cap, right edge back, start cap', () => {
    const ops = strokeOutline([[0, 0], [10, 0]], [2, 2])
    expect(ops[0]).toEqual({ op: 'M', p: [0, 1] })
    expect(ops[1]).toEqual({ op: 'L', p: [10, 1] })
    // End cap through the front of the stroke to the right edge.
    expect(ops[2]).toMatchObject({ op: 'C', p: [11, 0] })
    expect(ops[3]).toMatchObject({ op: 'C', p: [10, -1] })
    expect(ops[4]).toEqual({ op: 'L', p: [0, -1] })
    expect(ops[5]).toMatchObject({ op: 'C', p: [-1, 0] })
    expect(ops[6]).toMatchObject({ op: 'C', p: [0, 1] })
    expect(ops[7]).toEqual({ op: 'Z' })
    expect(ops).toHaveLength(8)
  })

  it('widens with the per-point width', () => {
    const ops = strokeOutline([[0, 0], [10, 0]], [0.8, 3.2])
    expect(ops[0]).toEqual({ op: 'M', p: [0, 0.4] })
    expect(ops[1]).toEqual({ op: 'L', p: [10, 1.6] })
  })

  it('draws a single point (or a stroke without length) as a circle', () => {
    for (const ops of [strokeOutline([[5, 5]], [2]), strokeOutline([[5, 5], [5, 5]], [2, 2])]) {
      expect(ops[0]).toEqual({ op: 'M', p: [6, 5] })
      expect(ops.filter((o) => o.op === 'C')).toHaveLength(4)
      expect(ops.at(-1)).toEqual({ op: 'Z' })
    }
  })

  it('follows the curved centre line on both sides', () => {
    const ops = strokeOutline([[0, 0], [10, 0], [20, 10]], [2, 2, 2])
    const ps = points(ops)
    // Every outline point lies within half the width (plus control overshoot) of the centre line's hull.
    for (const [x, y] of ps) {
      expect(x).toBeGreaterThanOrEqual(-1.001)
      expect(x).toBeLessThanOrEqual(21.5)
      expect(y).toBeGreaterThanOrEqual(-1.5)
      expect(y).toBeLessThanOrEqual(11.5)
    }
    expect(ops.filter((o) => o.op === 'M')).toHaveLength(1)
    expect(ops.at(-1)).toEqual({ op: 'Z' })
  })

  it('is empty for an empty stroke', () => {
    expect(strokeOutline([], [])).toEqual([])
  })
})

describe('inkOutlines / outlinePath', () => {
  it('outlines every stroke into one path and maps points to the screen', () => {
    const a = ink({ strokes: [[[0, 0], [10, 0]], [[5, 5]]], pressure: [[0.5, 0.5], [0.5]] })
    const ops = inkOutlines(a)
    expect(ops.filter((o) => o.op === 'M')).toHaveLength(2)
    const d = outlinePath(ops, ([x, y]) => [x * 2, 100 - y])
    expect(d.startsWith('M0 99 L20 99 C')).toBe(true)
    expect(d.match(/Z/g)).toHaveLength(2)
  })

  it('maps without recomputing: same ops, any transform', () => {
    const ops = strokeOutline([[0, 0], [10, 0]], [2, 2])
    expect(outlinePath(ops, id)).toContain('L10 1')
    expect(outlinePath(ops, ([x, y]) => [x + 1, y])).toContain('L11 1')
  })
})

describe('smoothPressure', () => {
  it('averages neighbours and keeps the ends', () => {
    const s = smoothPressure([0, 0.3, 0.9, 0.3])
    ;[0, 0.4, 0.5, 0.3].forEach((v, i) => expect(s[i]).toBeCloseTo(v))
    expect(smoothPressure([0.2, 0.4])).toEqual([0.2, 0.4])
  })
})

describe('simplifyWithWidths / dedupeIndices', () => {
  it('drops a collinear point of constant width', () => {
    expect(simplifyWithWidths([[0, 0], [5, 0], [10, 0]], [2, 2, 2], 0.1)).toEqual([0, 2])
  })
  it('keeps a collinear point where the width changes', () => {
    expect(simplifyWithWidths([[0, 0], [5, 0], [10, 0]], [1, 3, 1], 0.1)).toEqual([0, 1, 2])
  })
  it('keeps a linear width ramp simplified', () => {
    expect(simplifyWithWidths([[0, 0], [5, 0], [10, 0]], [1, 2, 3], 0.1)).toEqual([0, 2])
  })
  it('keeps the same points as dedupe', () => {
    const pts: Point[] = [[0, 0], [0.1, 0], [1, 0], [1.2, 0], [2, 0], [2.1, 0]]
    expect(dedupeIndices(pts, 0.5).map((i) => pts[i])).toEqual(dedupe(pts, 0.5))
  })
})
