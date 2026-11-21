import { describe, expect, it } from 'vitest'
import { visibleRange } from '../../../src/core/viewer/layout'
import { SIDEBAR_TILE, scrollToShow, thumbnailLayout, thumbnailSize } from '../../../src/core/viewer/thumbnailList'

const A4 = { width: 595, height: 842 }
const LANDSCAPE = { width: 842, height: 595 }

describe('thumbnailSize', () => {
  it('fits a portrait page to the box width, capped in height', () => {
    expect(thumbnailSize(A4.width, A4.height)).toEqual({ w: 112, h: 158 })
    // A very tall page is limited by the height cap, not the width.
    const tall = thumbnailSize(100, 1000)
    expect(tall.h).toBe(SIDEBAR_TILE.maxH)
    expect(tall.w).toBe(16)
  })

  it('a landscape page takes the full width', () => {
    expect(thumbnailSize(LANDSCAPE.width, LANDSCAPE.height)).toEqual({ w: 112, h: 79 })
  })
})

describe('thumbnailLayout', () => {
  it('stacks tiles by their preview heights, with gaps', () => {
    const l = thumbnailLayout([A4, LANDSCAPE, A4])
    const tile = (h: number) => 8 + h + 4 + SIDEBAR_TILE.label
    expect(l.heights).toEqual([tile(158), tile(79), tile(158)])
    expect(l.tops[0]).toBe(SIDEBAR_TILE.gap)
    expect(l.tops[1]).toBe(l.tops[0] + l.heights[0] + SIDEBAR_TILE.gap)
    expect(l.totalHeight).toBe(l.tops[2] + l.heights[2] + SIDEBAR_TILE.gap)
  })

  it('an empty document has no tiles', () => {
    expect(thumbnailLayout([]).tops).toEqual([])
  })

  it('only a window of a long document is in view', () => {
    const l = thumbnailLayout(Array.from({ length: 1000 }, () => A4))
    const r = visibleRange(l, l.tops[500], 600, 3)
    expect(r.first).toBe(497)
    expect(r.last - r.first).toBeLessThan(12)
  })
})

describe('scrollToShow', () => {
  const l = thumbnailLayout(Array.from({ length: 50 }, () => A4))

  it('leaves a tile fully in view alone', () => {
    expect(scrollToShow(l, 0, 0, 600)).toBeNull()
    expect(scrollToShow(l, 10, l.tops[10] - 5, 600)).toBeNull()
  })

  it('centres a tile above or below the view', () => {
    const to = scrollToShow(l, 20, 0, 600)!
    expect(to + 300).toBeCloseTo(l.tops[20] + l.heights[20] / 2)
    expect(scrollToShow(l, 2, l.tops[30], 600)).toBe(Math.max(0, l.tops[2] + l.heights[2] / 2 - 300))
  })

  it('stays within the column', () => {
    expect(scrollToShow(l, 49, 0, 600)).toBe(l.totalHeight - 600)
    expect(scrollToShow(l, 99, 0, 600)).toBeNull()
    expect(scrollToShow(l, 5, 0, 0)).toBeNull()
  })
})
