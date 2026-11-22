/** A box in client px. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Room (px) between the card and the bar or the selection. */
export const CARD_GAP = 6

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)))

/**
 * Where the selection's Style card goes (client px), so the element being
 * styled stays visible while its controls are dragged:
 *
 * 1. away from the selection, past the bar (above it when the bar is above
 *    the selection), aligned with the bar's left edge;
 * 2. beside the selection, right then left, top-aligned with the bar;
 * 3. on the selection's side of the bar (covering it), when nothing else fits.
 *
 * Always inside `bounds` (the viewer, already inset by a margin), never over
 * the toolbar or title bar; a card taller than the viewer gets `maxHeight`
 * and scrolls. Null when the selection is out of the viewer (scrolled away):
 * the card has nothing to stay next to.
 */
export function placeCard(o: {
  bar: Box
  selection: Box
  card: { width: number; height: number }
  /** Whether the bar sits above the selection (else below it). */
  barAbove: boolean
  bounds: Box
}): { left: number; top: number; maxHeight: number } | null {
  const { bar, selection: sel, bounds } = o
  if (sel.bottom < bounds.top || sel.top > bounds.bottom || sel.right < bounds.left || sel.left > bounds.right) return null
  const maxHeight = bounds.bottom - bounds.top
  const w = o.card.width
  const h = Math.min(o.card.height, maxHeight)
  const fitsV = (top: number) => top >= bounds.top && top + h <= bounds.bottom
  const fitsH = (left: number) => left >= bounds.left && left + w <= bounds.right
  const barLeft = clamp(bar.left, bounds.left, bounds.right - w)
  const above = bar.top - CARD_GAP - h
  const below = bar.bottom + CARD_GAP

  const away = o.barAbove ? above : below
  if (fitsV(away)) return { left: barLeft, top: away, maxHeight }

  const sideTop = clamp(bar.top, bounds.top, bounds.bottom - h)
  const right = Math.max(sel.right, bar.right) + CARD_GAP
  if (fitsH(right)) return { left: right, top: sideTop, maxHeight }
  const left = Math.min(sel.left, bar.left) - CARD_GAP - w
  if (fitsH(left)) return { left, top: sideTop, maxHeight }

  const toward = o.barAbove ? below : above
  if (fitsV(toward)) return { left: barLeft, top: toward, maxHeight }
  return { left: barLeft, top: clamp(away, bounds.top, bounds.bottom - h), maxHeight }
}

/** Height (px) of the selection bar, roughly. */
export const BAR_H = 34
/** Room (px) between the selection bar and the selection: clear of the resize handles. */
export const BAR_GAP = 12

/**
 * Whether the selection bar goes above the selection whose screen bounds
 * (page px, y down) are `rect`: there is room for it above, else it goes
 * below. The rotate handle takes the other side (see rotateHandlePoint).
 */
export function barAbove(rect: readonly number[]): boolean {
  return rect[1] - BAR_H - BAR_GAP >= 0
}
