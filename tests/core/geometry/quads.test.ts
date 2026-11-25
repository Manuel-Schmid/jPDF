import { describe, expect, it } from 'vitest'
import { mergeLineRects, rectsToQuads, type ScreenRect } from '../../../src/core/geometry/quads'
import type { Point } from '../../../src/core/session/model'

const flip = (x: number, y: number): Point => [x, 800 - y]
const id = (x: number, y: number): Point => [x, y]
const r = (left: number, top: number, right: number, bottom: number): ScreenRect => ({ left, top, right, bottom })

describe('rectsToQuads', () => {
  it('rectsToQuads merges two rects on the same line into one quad', () => {
    // Second word: 2px lower centre, 3px gap.
    const quads = rectsToQuads([r(10, 100, 50, 110), r(53, 101, 90, 113)], id)
    expect(quads).toEqual([[10, 100, 90, 100, 10, 113, 90, 113]])
  })

  it('rectsToQuads keeps separate lines separate', () => {
    const quads = rectsToQuads([r(10, 100, 50, 110), r(10, 120, 50, 130)], id)
    expect(quads).toHaveLength(2)
    expect(quads[0]).toEqual([10, 100, 50, 100, 10, 110, 50, 110])
    expect(quads[1]).toEqual([10, 120, 50, 120, 10, 130, 50, 130])
  })

  it('rectsToQuads drops zero-size rects', () => {
    const quads = rectsToQuads([r(10, 100, 10, 110), r(10, 100, 50, 100.5), r(20, 200, 40, 210)], id)
    expect(quads).toEqual([[20, 200, 40, 200, 20, 210, 40, 210]])
  })

  it('accepts DOMRect-like rects whose edges are prototype getters (Range.getClientRects)', () => {
    class Rect {
      constructor(private x: number, private y: number, private w: number, private h: number) {}
      get left() { return this.x }
      get top() { return this.y }
      get right() { return this.x + this.w }
      get bottom() { return this.y + this.h }
    }
    const quads = rectsToQuads([new Rect(10, 100, 40, 10), new Rect(10, 120, 40, 10)], id)
    expect(quads).toEqual([
      [10, 100, 50, 100, 10, 110, 50, 110],
      [10, 120, 50, 120, 10, 130, 50, 130],
    ])
  })

  it('quad corner order is TL,TR,BL,BR in PDF space', () => {
    expect(rectsToQuads([r(10, 100, 50, 110)], flip)).toEqual([[10, 700, 50, 700, 10, 690, 50, 690]])
  })

  it('does not merge same-line rects with a gap over 4px', () => {
    expect(rectsToQuads([r(10, 100, 50, 110), r(55, 100, 90, 110)], id)).toHaveLength(2)
  })

  it('merges a chain of touching fragments given in any order', () => {
    const quads = rectsToQuads([r(60, 100, 90, 110), r(10, 100, 30, 110), r(30, 100, 60, 110)], id)
    expect(quads).toEqual([[10, 100, 90, 100, 10, 110, 90, 110]])
  })

  it('honours a custom line tolerance', () => {
    const rects = [r(10, 100, 50, 110), r(50, 105, 90, 115)] // centres 5px apart
    expect(rectsToQuads(rects, id)).toHaveLength(2)
    expect(rectsToQuads(rects, id, 6)).toHaveLength(1)
  })

  it('orders quads top to bottom', () => {
    const quads = rectsToQuads([r(10, 120, 50, 130), r(10, 100, 50, 110)], id)
    expect(quads.map((q) => q[1])).toEqual([100, 120])
  })

  it('mergeLineRects accepts a dynamic per-pair maxGap function', () => {
    const small = [r(10, 100, 50, 110), r(58, 100, 90, 110)] // height 10, gap 8
    const large = [r(10, 100, 50, 120), r(58, 100, 90, 120)] // height 20, gap 8
    const halfHeight = (a: ScreenRect, b: ScreenRect) => 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top)
    expect(mergeLineRects(small, 2, halfHeight)).toHaveLength(2)
    expect(mergeLineRects(large, 2, halfHeight)).toEqual([r(10, 100, 90, 120)])
  })
})
