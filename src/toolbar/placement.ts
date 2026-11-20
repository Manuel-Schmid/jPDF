import type { ToolbarPosition } from '../core/settings/preferences'

/** Vertical strip at the left/right edge, horizontal at the top/bottom. */
export type Axis = 'vertical' | 'horizontal'

export function toolbarAxis(position: ToolbarPosition): Axis {
  return position === 'left' || position === 'right' ? 'vertical' : 'horizontal'
}

/** The side popups open toward from the toolbar: the page area, opposite the toolbar's edge. */
export type Side = 'left' | 'right' | 'top' | 'bottom'

const TOWARD_PAGE: Record<ToolbarPosition, Side> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }

export function towardPage(position: ToolbarPosition): Side {
  return TOWARD_PAGE[position]
}

/** CSS grid of the window shell: named areas plus row and column tracks. */
export interface ShellLayout {
  areas: string
  rows: string
  columns: string
}

const ROW = { title: 'var(--titlebar-h)', strip: 'var(--toolstrip-w)', status: 'var(--statusbar-h)' }
/** A full-width column that may shrink below its content (a top/bottom strip then scrolls instead of widening the window). */
const FILL = 'minmax(0, 1fr)'

/**
 * Grid of the window shell for a toolbar `position`. Areas: `title`, `viewer`,
 * `tools`, `status`. At the left/right edge the strip runs between the title
 * bar and the status bar; at the top it sits below the title bar, at the
 * bottom just above the status bar. Fullscreen shows the viewer alone; the
 * Document Builder (`building`) takes the toolbar's place too.
 */
export function shellLayout(position: ToolbarPosition, mode: { fullscreen?: boolean; building?: boolean } = {}): ShellLayout {
  if (mode.fullscreen) return { areas: '"viewer"', rows: '1fr', columns: '1fr' }
  if (mode.building) {
    return { areas: '"title" "viewer" "status"', rows: `${ROW.title} 1fr ${ROW.status}`, columns: '1fr' }
  }
  switch (position) {
    case 'right':
    case 'left': {
      const mid = position === 'right' ? '"viewer tools"' : '"tools viewer"'
      const cols = position === 'right' ? '1fr var(--toolstrip-w)' : 'var(--toolstrip-w) 1fr'
      return { areas: `"title title" ${mid} "status status"`, rows: `${ROW.title} 1fr ${ROW.status}`, columns: cols }
    }
    case 'top':
      return { areas: '"title" "tools" "viewer" "status"', rows: `${ROW.title} ${ROW.strip} 1fr ${ROW.status}`, columns: FILL }
    case 'bottom':
      return { areas: '"title" "viewer" "tools" "status"', rows: `${ROW.title} 1fr ${ROW.strip} ${ROW.status}`, columns: FILL }
  }
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const GAP = 8
const MARGIN = 8

/** `v` limited to [MARGIN, max]; the margin wins when the window is too small. */
function fit(v: number, max: number): number {
  return Math.max(MARGIN, Math.min(v, max))
}

/**
 * Where a `w` x `h` popup anchored to `anchor` goes in a `vw` x `vh` window,
 * opening toward `side` with a small gap. To the left or right it is
 * top-aligned with the anchor, above or below it is left-aligned; either way
 * it is kept inside the window (by at least an 8px margin).
 */
export function flyoutPosition(anchor: Rect, w: number, h: number, vw: number, vh: number, side: Side): { left: number; top: number } {
  const maxLeft = vw - w - MARGIN
  const maxTop = vh - h - MARGIN
  switch (side) {
    case 'left':
      return { left: fit(anchor.left - GAP - w, maxLeft), top: fit(anchor.top, maxTop) }
    case 'right':
      return { left: fit(anchor.right + GAP, maxLeft), top: fit(anchor.top, maxTop) }
    case 'top':
      return { left: fit(anchor.left, maxLeft), top: fit(anchor.top - GAP - h, maxTop) }
    case 'bottom':
      return { left: fit(anchor.left, maxLeft), top: fit(anchor.bottom + GAP, maxTop) }
  }
}
