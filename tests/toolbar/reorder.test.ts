import { describe, expect, it } from 'vitest'
import { insertionIndex, reorderTarget } from '../../src/toolbar/reorder'

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
