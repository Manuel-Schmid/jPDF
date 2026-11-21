import type { Layout } from './layout'

/**
 * Geometry of the thumbnail sidebar's column. Every tile's height follows
 * from its page size alone, so the whole list is laid out without the DOM
 * and only the tiles in view are mounted (visibleRange of layout.ts).
 */

/** Tile metrics (CSS px). The sidebar is SIDEBAR_TILE.box + 2 * pad wide (--sidebar-w). */
export const SIDEBAR_TILE = {
  /** Width of the page preview; tall pages are capped at `maxH`. */
  box: 112,
  maxH: 160,
  /** Padding around the preview inside the tile. */
  pad: 24,
  /** Page number label below the preview. */
  label: 20,
  /** Space between tiles. */
  gap: 4,
} as const

/** The preview size (CSS px) of a `width` x `height` page: fitted into box x maxH. */
export function thumbnailSize(width: number, height: number): { w: number; h: number } {
  const k = Math.min(SIDEBAR_TILE.box / width, SIDEBAR_TILE.maxH / height)
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) }
}

/** Tile heights and tops of the column (a Layout, so visibleRange applies). */
export function thumbnailLayout(sizes: readonly { width: number; height: number }[]): Layout {
  const tops: number[] = []
  const heights: number[] = []
  const widths: number[] = []
  let y = SIDEBAR_TILE.gap
  for (const s of sizes) {
    const { h } = thumbnailSize(s.width, s.height)
    const tile = 8 + h + 4 + SIDEBAR_TILE.label
    tops.push(y)
    heights.push(tile)
    widths.push(SIDEBAR_TILE.box)
    y += tile + SIDEBAR_TILE.gap
  }
  return { tops, heights, widths, totalHeight: y, maxWidth: SIDEBAR_TILE.box }
}

/**
 * The scroll position that brings tile `i` into a `viewH` view scrolled to
 * `scrollTop`, or null when it is fully in view already. A tile above or
 * below is centred, so the pages around it show too.
 */
export function scrollToShow(l: Layout, i: number, scrollTop: number, viewH: number): number | null {
  if (i < 0 || i >= l.tops.length || viewH <= 0) return null
  const top = l.tops[i]
  const bottom = top + l.heights[i]
  if (top >= scrollTop && bottom <= scrollTop + viewH) return null
  const centred = top + l.heights[i] / 2 - viewH / 2
  return Math.max(0, Math.min(centred, l.totalHeight - viewH))
}
