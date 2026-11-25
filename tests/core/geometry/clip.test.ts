import { describe, expect, it } from 'vitest'
import { clipPolyline, type Box } from '../../../src/core/geometry/clip'

const box: Box = [0, 0, 100, 200]

describe('clipPolyline', () => {
  it('leaves a stroke inside the box unchanged', () => {
    const pts: [number, number][] = [[10, 10], [50, 60], [90, 190]]
    expect(clipPolyline(pts, null, box)).toEqual({ strokes: [pts], pressure: null })
  })

  it('ends a stroke that leaves the box exactly on the edge', () => {
    // Down past the bottom edge (y = 0), then on outside.
    const r = clipPolyline([[10, 20], [10, -20], [30, -40]], null, box)
    expect(r.strokes).toEqual([[[10, 20], [10, 0]]])
  })

  it('starts a stroke that enters the box on the edge', () => {
    const r = clipPolyline([[50, 250], [50, 150]], null, box)
    expect(r.strokes).toEqual([[[50, 200], [50, 150]]])
  })

  it('splits a stroke that leaves and comes back into two strokes', () => {
    const r = clipPolyline([[90, 10], [110, 10], [110, 30], [90, 30]], null, box)
    expect(r.strokes).toEqual([
      [[90, 10], [100, 10]],
      [[100, 30], [90, 30]],
    ])
  })

  it('keeps the inside part of a segment that crosses the whole box', () => {
    const r = clipPolyline([[-50, 100], [150, 100]], null, box)
    expect(r.strokes).toEqual([[[0, 100], [100, 100]]])
  })

  it('interpolates pressure at the crossing points', () => {
    const r = clipPolyline([[50, 100], [150, 100]], [0.2, 0.6], box)
    expect(r.strokes).toEqual([[[50, 100], [100, 100]]])
    expect(r.pressure![0][0]).toBe(0.2)
    expect(r.pressure![0][1]).toBeCloseTo(0.4)
  })

  it('keeps one pressure array per resulting stroke', () => {
    const r = clipPolyline([[90, 10], [110, 10], [110, 30], [90, 30]], [0.1, 0.3, 0.5, 0.7], box)
    expect(r.pressure).toHaveLength(2)
    expect(r.pressure!.map((p) => p.length)).toEqual([2, 2])
    expect(r.pressure![0][1]).toBeCloseTo(0.2)
    expect(r.pressure![1][0]).toBeCloseTo(0.6)
  })

  it('returns nothing for a stroke entirely outside', () => {
    expect(clipPolyline([[-10, -10], [-20, -30]], null, box).strokes).toEqual([])
  })

  it('drops a segment that only touches a corner', () => {
    expect(clipPolyline([[-10, 10], [10, -10]], null, box).strokes).toEqual([])
  })

  it('counts points on the edge as inside', () => {
    expect(clipPolyline([[0, 10], [0, 50]], null, box).strokes).toEqual([[[0, 10], [0, 50]]])
  })

  it('keeps a dot inside and drops one outside', () => {
    expect(clipPolyline([[5, 5]], [0.5], box)).toEqual({ strokes: [[[5, 5]]], pressure: [[0.5]] })
    expect(clipPolyline([[-5, 5]], [0.5], box)).toEqual({ strokes: [], pressure: [] })
  })

  it('accepts a box with corners in any order (a cropped page)', () => {
    const r = clipPolyline([[50, 50], [50, 0]], null, [100, 300, 20, 20])
    expect(r.strokes).toEqual([[[50, 50], [50, 20]]])
  })
})
