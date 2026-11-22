import { describe, expect, it } from 'vitest'
import '../../../src/annotations'
import { frameBounds, grabAt, grabCursor, handleAt, intoFrame, keepAspect, outOfFrame, resizeRect, ROTATE_CURSOR } from '../../../src/tools/select/handles'

// Screen-space rects: [left, top, right, bottom], y down.
describe('keepAspect', () => {
  const box: [number, number, number, number] = [0, 0, 40, 20]

  it('scales by the larger factor from the opposite corner, limited to the bounds', () => {
    expect(keepAspect(box, [0, 0, 60, 25], 'se', [0, 0, 400, 400], 4)).toEqual([0, 0, 60, 30])
    expect(keepAspect(box, [0, 0, 400, 25], 'se', [0, 0, 100, 400], 4)).toEqual([0, 0, 100, 50])
    expect(keepAspect(box, [0, 0, 50, 20], 'e', [0, 0, 100, 400], 4)).toEqual([0, 0, 50, 20])
  })

  it('never shrinks the image just because it already reaches past the bounds', () => {
    // Only 10 px of room right of the anchor: growing stops at the current size.
    expect(keepAspect(box, [0, 0, 80, 40], 'se', [0, 0, 10, 400], 4)).toEqual([0, 0, 40, 20])
    // Shrinking still works.
    expect(keepAspect(box, [0, 0, 20, 10], 'se', [0, 0, 10, 400], 4)).toEqual([0, 0, 20, 10])
  })

  it('ignores the bounds when the anchor corner lies outside them (no mirroring)', () => {
    expect(keepAspect(box, [0, 0, 80, 40], 'se', [-100, -100, -10, -10], 4)).toEqual([0, 0, 80, 40])
    expect(keepAspect(box, [-40, 0, 40, 40], 'sw', [50, 0, 400, 400], 4)).toEqual([-40, 0, 40, 40])
  })

  it('keeps at least the minimum size', () => {
    expect(keepAspect(box, [0, 0, 2, 1], 'se', [0, 0, 400, 400], 10)).toEqual([0, 0, 20, 10])
  })
})

describe('select handles', () => {
  it('resizeRect se grows by dx,dy', () => {
    expect(resizeRect([10, 20, 110, 70], 'se', 15, 5, 8)).toEqual([10, 20, 125, 75])
  })

  it('resizeRect w moves x1 and keeps x2', () => {
    expect(resizeRect([10, 20, 110, 70], 'w', -30, 12, 8)).toEqual([-20, 20, 110, 70])
    expect(resizeRect([10, 20, 110, 70], 'n', 40, 10, 8)).toEqual([10, 30, 110, 70])
  })

  it('resizeRect enforces minSize', () => {
    expect(resizeRect([10, 20, 110, 70], 'w', 200, 0, 24)).toEqual([86, 20, 110, 70])
    expect(resizeRect([10, 20, 110, 70], 'se', -500, -500, 8)).toEqual([10, 20, 18, 28])
    expect(resizeRect([10, 20, 110, 70], 'nw', 500, 500, 8)).toEqual([102, 62, 110, 70])
  })

  it('handleAt returns se near bottom-right corner, null in centre', () => {
    const r: [number, number, number, number] = [0, 0, 100, 50]
    expect(handleAt(r, [102, 48], 5)).toBe('se')
    expect(handleAt(r, [50, 1], 5)).toBe('n')
    expect(handleAt(r, [-3, 25], 5)).toBe('w')
    expect(handleAt(r, [50, 25], 5)).toBeNull()
    expect(handleAt(r, [130, 25], 5)).toBeNull()
  })

  it('handleAt grabs an edge pill over its whole length, corners only nearby', () => {
    const r: [number, number, number, number] = [0, 0, 100, 50]
    // 10px along the top edge from its centre: beyond the 5px tolerance, on a 21px pill.
    expect(handleAt(r, [60, 1], 5)).toBeNull()
    expect(handleAt(r, [60, 1], 5, undefined, 21)).toBe('n')
    expect(handleAt(r, [-2, 35], 5, undefined, 21)).toBe('w')
    // Across the edge the tolerance stays 5px; corners do not grow.
    expect(handleAt(r, [60, 8], 5, undefined, 21)).toBeNull()
    expect(handleAt(r, [108, 8], 5, undefined, 21)).toBeNull()
  })

  it('handleAt only considers the allowed handles', () => {
    expect(handleAt([0, 0, 100, 50], [100, 50], 5, ['e', 'w'])).toBeNull()
    expect(handleAt([0, 0, 100, 50], [100, 25], 5, ['e', 'w'])).toBe('e')
  })
})

describe('turned selection frames', () => {
  const close = (p: readonly number[], q: readonly number[]) => p.forEach((v, i) => expect(v).toBeCloseTo(q[i], 9))
  const f = { rect: [0, 0, 40, 20] as [number, number, number, number], angle: 90 }

  it('maps screen points into the turned frame and back', () => {
    // Centre (20, 10): the frame's east middle (40, 10) sits above the centre on screen.
    close(outOfFrame(f, [40, 10]), [20, -10])
    close(intoFrame(f, [20, -10]), [40, 10])
    close(frameBounds(f), [10, -10, 30, 30])
  })

  it('grabs the rotate handle above the top edge, and resize handles on the turned box', () => {
    const upright = { ...f, angle: 0 }
    expect(grabAt(upright, [20, -22], 6, [], true)).toBe('rotate')
    expect(grabAt(upright, [20, -22], 6, [], false)).toBeNull()
    expect(grabAt(f, [20, -10], 6, ['e', 'w'], true)).toBe('e')
    // With room for the bar above, the handle goes below the box.
    expect(grabAt({ rect: [0, 100, 40, 120], angle: 0 }, [20, 142], 6, [], true)).toBe('rotate')
    expect(grabAt({ rect: [0, 100, 40, 120], angle: 0 }, [20, 78], 6, [], true)).toBeNull()
    // Turned a quarter counter-clockwise, the rotate handle points left.
    expect(grabAt(f, [-12, 10], 6, [], true)).toBe('rotate')
  })

  it('turns resize cursors with the frame', () => {
    expect(grabCursor('e')).toBe('ew-resize')
    expect(grabCursor('e', 90)).toBe('ns-resize')
    expect(grabCursor('ne', 90)).toBe('nwse-resize')
    expect(grabCursor('n', 40)).toBe('nwse-resize')
    expect(grabCursor('rotate', 30)).toBe(ROTATE_CURSOR)
  })
})
