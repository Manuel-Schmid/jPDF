import { describe, expect, it } from 'vitest'
import {
  FIELD_BODY, FIELD_GAP, FIELD_HEADER, FIELD_MIN_WIDTH, NOTE_HEIGHT, fieldBox, fieldExtra, fieldStates,
} from '../../../src/core/viewer/explanationLayout'
import { computeLayout, PAGE_GAP, visibleRange, zoomAround } from '../../../src/core/viewer/layout'
import type { Explanation } from '../../../src/core/session/model'
import { identityPages } from '../../../src/core/session/pages'

const ex = (text: string): Explanation => ({ text, model: null, createdAt: '' })

describe('fieldStates', () => {
  const pages = identityPages(4)
  const a = ex('a')
  const b = ex('b')

  it('shows open or collapsed explanations, the no-text note, or nothing', () => {
    expect(fieldStates(pages, [a, b, null, null], new Set([pages[2]]), new Set([b]), false)).toEqual([
      'open', 'collapsed', 'note', 'none',
    ])
  })

  it('hides everything at once', () => {
    expect(fieldStates(pages, [a, b, null, null], new Set([pages[2]]), new Set(), true)).toEqual([
      'none', 'none', 'none', 'none',
    ])
  })
})

describe('field heights in the layout', () => {
  it('reserves fixed heights, unscaled by zoom', () => {
    expect(fieldExtra('none')).toBe(0)
    expect(fieldExtra('note')).toBe(FIELD_GAP + NOTE_HEIGHT)
    expect(fieldExtra('collapsed')).toBe(FIELD_GAP + FIELD_HEADER)
    expect(fieldExtra('open')).toBe(FIELD_GAP + FIELD_HEADER + FIELD_BODY)
  })

  it('pushes the following pages down by the field height', () => {
    const sizes = [{ width: 600, height: 800 }, { width: 600, height: 800 }]
    const extra = fieldExtra('open')
    for (const scale of [0.5, 1, 2]) {
      const l = computeLayout(sizes, scale, [extra, 0])
      expect(l.tops[1]).toBe(PAGE_GAP + 800 * scale + extra + PAGE_GAP)
      expect(l.totalHeight).toBe(l.tops[1] + 800 * scale + PAGE_GAP)
      expect(l.extras).toEqual([extra, 0])
    }
  })

  it('keeps a page mounted while only its field is in view', () => {
    const l = computeLayout([{ width: 600, height: 800 }, { width: 600, height: 800 }], 1, [150, 0])
    // Scrolled past page 1 itself, into its field.
    expect(visibleRange(l, 16 + 800 + 50, 40, 0).first).toBe(0)
  })

  it('zooming on a field keeps the field under the pointer', () => {
    const sizes = [{ width: 600, height: 800 }]
    const l0 = computeLayout(sizes, 1, [150])
    const l1 = computeLayout(sizes, 2, [150])
    // Pointer 60 px below the page's bottom edge (on its field).
    const anchor = { x: 300, y: 16 + 800 + 60 }
    const pos = zoomAround(l0, l1, 1, 2, anchor, { top: 0, left: 0 }, 700)
    expect(pos.top + anchor.y).toBe(16 + 1600 + 60)
  })
})

describe('fieldBox', () => {
  it('is centred under the page and as wide as it', () => {
    expect(fieldBox(100, 600, 800, 16)).toEqual({ left: 100, width: 600 })
  })

  it('is at least FIELD_MIN_WIDTH wide under a narrow page, inside the content', () => {
    const box = fieldBox(380, 40, 800, 16)
    expect(box.width).toBe(FIELD_MIN_WIDTH)
    expect(box.left).toBe(380 + 20 - FIELD_MIN_WIDTH / 2)
    expect(fieldBox(10, 40, 300, 16)).toEqual({ left: 16, width: 268 })
  })
})
