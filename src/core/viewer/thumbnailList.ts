import type { Layout } from './layout'

/**
 * Geometry of the thumbnail sidebar's column. Every tile's height follows
 * from its page size alone, so the whole list is laid out without the DOM
 * and only the tiles in view are mounted (visibleRange of layout.ts).
 */

/** Tile metrics (CSS px) at the default width. The sidebar is box + 2 * pad wide (--sidebar-w). */
export const SIDEBAR_TILE = {
  /** Width of the page preview; tall pages are capped at `maxH` (both scale with the sidebar, see tileBox). */
  box: 112,
  maxH: 160,
  /** Padding around the preview inside the tile. */
  pad: 24,
  /** Page number label below the preview. */
  label: 20,
  /** Space between tiles. */
  gap: 4,
} as const

/** Widths (CSS px) the sidebar can be dragged to; `initial` until the user resizes it. */
export const SIDEBAR_WIDTH = { min: 120, initial: SIDEBAR_TILE.box + 2 * SIDEBAR_TILE.pad, max: 360 } as const

/** `width` within SIDEBAR_WIDTH, whole pixels. */
export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))
}

/** Width (CSS px) of the page previews in a sidebar `width` wide. */
export function tileBox(width: number): number {
  return clampSidebarWidth(width) - 2 * SIDEBAR_TILE.pad
}

/**
 * The preview size (CSS px) of a `width` x `height` page: fitted into
 * `box` wide and (keeping the default proportions) box * maxH / box tall.
 */
export function thumbnailSize(width: number, height: number, box: number = SIDEBAR_TILE.box): { w: number; h: number } {
  const maxH = (box * SIDEBAR_TILE.maxH) / SIDEBAR_TILE.box
  const k = Math.min(box / width, maxH / height)
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) }
}

/** Tile heights and tops of the column, previews `box` wide (a Layout, so visibleRange applies). */
export function thumbnailLayout(sizes: readonly { width: number; height: number }[], box: number = SIDEBAR_TILE.box): Layout {
  const tops: number[] = []
  const heights: number[] = []
  const widths: number[] = []
  let y = SIDEBAR_TILE.gap
  for (const s of sizes) {
    const { h } = thumbnailSize(s.width, s.height, box)
    const tile = 8 + h + 4 + SIDEBAR_TILE.label
    tops.push(y)
    heights.push(tile)
    widths.push(box)
    y += tile + SIDEBAR_TILE.gap
  }
  // Thumbnails have no explanation fields below them.
  return { tops, heights, extras: tops.map(() => 0), widths, totalHeight: y, maxWidth: box }
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
