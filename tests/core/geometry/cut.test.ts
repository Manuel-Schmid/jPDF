import { describe, expect, it } from 'vitest'
import { cutInk, cutStroke } from '../../../src/core/geometry/cut'
import type { InkAnnotation, Point } from '../../../src/core/session/model'

const line: Point[] = [[0, 0], [10, 0], [20, 0], [30, 0]]

const ink = (strokes: Point[][], extra: Partial<InkAnnotation> = {}): InkAnnotation => ({
  id: 'i', kind: 'ink', page: 0, sourceRef: null, modifiedAt: '', author: '',
  strokes, color: [0, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen', ...extra,
})

describe('cutStroke', () => {
  it('returns null when the eraser misses the stroke', () => {
    expect(cutStroke(line, undefined, [15, 10], 3)).toBeNull()
    // Tangent: touches the line without entering it.
    expect(cutStroke(line, undefined, [15, 3], 3)).toBeNull()
  })

  it('splits a stroke in two, ending each piece on the circle', () => {
    const pieces = cutStroke(line, undefined, [15, 0], 3)!
    expect(pieces).toHaveLength(2)
    expect(pieces[0].points).toEqual([[0, 0], [10, 0], [12, 0]])
    expect(pieces[1].points).toEqual([[18, 0], [20, 0], [30, 0]])
    expect(pieces[0].pressure).toBeUndefined()
  })

  it('cuts inside one long segment, not only at its points', () => {
    const pieces = cutStroke([[0, 0], [100, 0]], undefined, [50, 1], 2)!
    expect(pieces.map((p) => p.points.length)).toEqual([2, 2])
    expect(pieces[0].points[1][0]).toBeCloseTo(50 - Math.sqrt(3))
    expect(pieces[1].points[0][0]).toBeCloseTo(50 + Math.sqrt(3))
  })

  it('trims an end, keeping one piece', () => {
    expect(cutStroke(line, undefined, [0, 0], 5)!.map((p) => p.points)).toEqual([[[5, 0], [10, 0], [20, 0], [30, 0]]])
    expect(cutStroke(line, undefined, [30, 0], 5)!.map((p) => p.points)).toEqual([[[0, 0], [10, 0], [20, 0], [25, 0]]])
  })

  it('returns an empty list when nothing is left', () => {
    expect(cutStroke(line, undefined, [15, 0], 40)).toEqual([])
    expect(cutStroke([[1, 1]], undefined, [1, 1], 2)).toEqual([])
    expect(cutStroke([[1, 1]], undefined, [9, 9], 2)).toBeNull()
  })

  it('splits and interpolates pressures with the points', () => {
    const pieces = cutStroke(line, [0, 0.2, 0.4, 0.6], [15, 0], 3)!
    expect(pieces[0].pressure).toHaveLength(3)
    expect(pieces[0].pressure![2]).toBeCloseTo(0.24)
    expect(pieces[1].pressure![0]).toBeCloseTo(0.36)
    expect(pieces[1].pressure!.slice(1)).toEqual([0.4, 0.6])
  })

  it('drops pieces shorter than minLength', () => {
    const pieces = cutStroke(line, undefined, [27, 0], 2, 3)!
    expect(pieces.map((p) => p.points.at(-1))).toEqual([[25, 0]])
  })

  it('handles a stroke that leaves and re-enters the eraser', () => {
    // A U-turn: both arms pass through the circle around (5, 0), the bend stays.
    const u: Point[] = [[0, 1], [10, 1], [10, -1], [0, -1]]
    const pieces = cutStroke(u, undefined, [5, 0], 2)!
    expect(pieces).toHaveLength(3)
    expect(pieces[0].points[0]).toEqual([0, 1])
    expect(pieces[1].points.slice(1, 3)).toEqual([[10, 1], [10, -1]])
    expect(pieces[2].points.at(-1)).toEqual([0, -1])
  })
})

describe('cutInk', () => {
  it('is undefined when no stroke is touched', () => {
    expect(cutInk(ink([line]), [15, 20], 3)).toBeUndefined()
  })

  it('reaches half the stroke width further than the eraser', () => {
    // width 2: the cut radius is 3 + 1.
    const cut = cutInk(ink([line]), [15, 0], 3)!
    expect(cut.strokes).toEqual([[[0, 0], [10, 0], [11, 0]], [[19, 0], [20, 0], [30, 0]]])
  })

  it('keeps untouched strokes and the pressure arrays parallel', () => {
    const other: Point[] = [[0, 50], [30, 50]]
    const a = ink([line, other], { pressure: [[0.5, 0.5, 0.5, 0.5], [0.5, 0.5]] })
    const cut = cutInk(a, [15, 0], 3)!
    expect(cut.strokes).toHaveLength(3)
    expect(cut.strokes[2]).toBe(other)
    expect(cut.pressure!.map((p) => p.length)).toEqual(cut.strokes.map((s) => s.length))
    expect(a.strokes).toHaveLength(2) // the original is not touched
  })

  it('leaves no strokes when everything is erased', () => {
    expect(cutInk(ink([line]), [15, 0], 40)!.strokes).toEqual([])
  })
})
