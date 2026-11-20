import { describe, expect, it } from 'vitest'
import { followOffset, insertionIndex, reorderTarget, slotOffsets } from '../../src/toolbar/reorder'

const ids = (s: string) => s.split('')

describe('insertionIndex', () => {
  it('counts the other buttons whose centre is above the pointer', () => {
    // centres at 20, 68, 116; the dragged one (index 0) is skipped
    expect(insertionIndex([20, 68, 116], 0, 10)).toBe(0)
    expect(insertionIndex([20, 68, 116], 0, 90)).toBe(1)
    expect(insertionIndex([20, 68, 116], 0, 500)).toBe(2)
    expect(insertionIndex([20, 68, 116], 2, 0)).toBe(0)
  })

  it('works the same along x for a horizontal strip (centres and pointer are x coordinates)', () => {
    // A top/bottom strip: buttons at x 0, 48, 96 (centres 20, 68, 116); drag the last one leftwards.
    expect(insertionIndex([20, 68, 116], 2, 50)).toBe(1)
    expect(insertionIndex([20, 68, 116], 1, 200)).toBe(2)
  })
})

describe('reorderTarget', () => {
  it('maps a visible insertion slot to a full-toolbar index', () => {
    // all visible: dragging a to the end of [b, c]
    expect(reorderTarget(ids('abc'), ids('abc'), 'a', 2)).toBe(2)
    expect(reorderTarget(ids('abc'), ids('abc'), 'c', 0)).toBe(0)
  })

  it('accounts for hidden (unregistered) instances', () => {
    // toolbar a X b c (X hidden); visible a b c; drag c before b → before b in the full list
    expect(reorderTarget(ids('aXbc'), ids('abc'), 'c', 1)).toBe(2)
    // drag a to the end → after c
    expect(reorderTarget(ids('aXbc'), ids('abc'), 'a', 2)).toBe(3)
  })

  it('returns null when nothing changes', () => {
    expect(reorderTarget(ids('abc'), ids('abc'), 'b', 1)).toBeNull()
    expect(reorderTarget(ids('a'), ids('a'), 'a', 0)).toBeNull()
  })
})

describe('slotOffsets', () => {
  // Four buttons 48px apart (40px button + 6px gap would be 46; any pitch works).
  const starts = [0, 48, 96, 144]

  it('is all zeros while the dragged button is in its own slot', () => {
    expect(slotOffsets(starts, 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('dragging forward: the dragged button jumps to its slot, the ones it passed shift back one slot', () => {
    // Drag a (0) to the end: b, c, d each move up one slot.
    expect(slotOffsets(starts, 0, 3)).toEqual([144, -48, -48, -48])
    // Drag b (1) past c only.
    expect(slotOffsets(starts, 1, 2)).toEqual([0, 48, -48, 0])
  })

  it('dragging backward: the ones it passed shift forward one slot', () => {
    // Drag d (3) to the front.
    expect(slotOffsets(starts, 3, 0)).toEqual([48, 48, 48, -144])
    // Drag c (2) before b.
    expect(slotOffsets(starts, 2, 1)).toEqual([0, 48, -48, 0])
  })

  it('works the same along x (starts are left edges of a horizontal strip)', () => {
    const lefts = [8, 54, 100]
    expect(slotOffsets(lefts, 0, 2)).toEqual([92, -46, -46])
    expect(slotOffsets(lefts, 2, 0)).toEqual([46, 46, -92])
  })

  it('every button lands on a distinct slot (nothing overlaps)', () => {
    for (let d = 0; d < starts.length; d++)
      for (let s = 0; s < starts.length; s++) {
        const shown = slotOffsets(starts, d, s).map((o, i) => starts[i] + o)
        expect([...shown].sort((a, b) => a - b)).toEqual(starts)
      }
  })
})

describe('followOffset', () => {
  const centres = [20, 68, 116] // 48px pitch

  it('tracks the button centre freely, any distance from where it started', () => {
    expect(followOffset(centres, 0, 30)).toBe(10)
    expect(followOffset(centres, 0, 90)).toBe(70)
    expect(followOffset(centres, 2, 50)).toBe(-66)
  })

  it('stays between the first and last slot', () => {
    expect(followOffset(centres, 0, 500)).toBe(96)
    expect(followOffset(centres, 1, -100)).toBe(-48)
  })

  it('relative to a slot: how far the dropped button is from its gap', () => {
    expect(followOffset(centres, 1, 80)).toBe(12)
  })

  it('a lone button does not move', () => {
    expect(followOffset([20], 0, 80)).toBe(0)
  })
})
