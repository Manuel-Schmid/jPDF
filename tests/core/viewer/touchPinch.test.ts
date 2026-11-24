import { describe, expect, it } from 'vitest'
import { clampScale } from '../../../src/core/viewer/layout'
import { pinchScale, startPinch } from '../../../src/core/viewer/touchPinch'

const t = (identifier: number, clientX: number, clientY: number) => ({
  identifier,
  clientX,
  clientY,
})

describe('startPinch', () => {
  it('needs two fingers', () => {
    expect(startPinch([], 1)).toBeNull()
    expect(startPinch([t(1, 10, 10)], 1)).toBeNull()
  })

  it('anchors between the first two fingers', () => {
    const s = startPinch([t(4, 100, 200), t(7, 300, 200), t(9, 0, 0)], 1.5)!
    expect(s.mid).toEqual({ x: 200, y: 200 })
    expect(s.pinch).toEqual({ ids: [4, 7], startDist: 200, startScale: 1.5 })
  })
})

describe('pinchScale', () => {
  const { pinch } = startPinch([t(1, 100, 100), t(2, 200, 100)], 1)!

  it('scales with the spread of the fingers', () => {
    expect(pinchScale(pinch, [t(1, 50, 100), t(2, 250, 100)])).toBeCloseTo(2)
    expect(pinchScale(pinch, [t(2, 175, 100), t(1, 125, 100)])).toBeCloseTo(0.5)
  })

  it('follows its own fingers, not a third one', () => {
    expect(pinchScale(pinch, [t(3, 0, 0), t(1, 100, 100), t(2, 300, 100)])).toBeCloseTo(2)
  })

  it('ends once one of its fingers lifted', () => {
    expect(pinchScale(pinch, [t(1, 100, 100)])).toBeNull()
    expect(pinchScale(pinch, [t(1, 100, 100), t(3, 400, 100)])).toBeNull()
  })

  it('clamps like every zoom', () => {
    expect(pinchScale(pinch, [t(1, 0, 0), t(2, 100_000, 0)])).toBe(clampScale(1000))
  })

  it('keeps the zoom when the fingers started on one spot', () => {
    const same = startPinch([t(1, 50, 50), t(2, 50, 50)], 1.25)!.pinch
    expect(pinchScale(same, [t(1, 0, 50), t(2, 100, 50)])).toBe(1.25)
  })
})
