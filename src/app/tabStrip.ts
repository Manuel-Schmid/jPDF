/**
 * Scroll logic for the title bar's tab strip. When the open tabs no longer
 * fit even at their minimum width, the strip scrolls horizontally (with no
 * visible scrollbar). These helpers are pure so they can be tested without
 * layout.
 */

/**
 * The `scrollLeft` that brings the tab at `tabLeft` (offset inside the
 * scrolled content) with `tabWidth` fully into a view of `viewWidth` that is
 * currently scrolled to `scrollLeft`. Scrolls as little as possible: a tab
 * that is already visible keeps the current position. A tab wider than the
 * view is aligned to its left edge so its name stays readable.
 */
export function scrollToReveal(
  scrollLeft: number,
  viewWidth: number,
  tabLeft: number,
  tabWidth: number,
): number {
  const tabRight = tabLeft + tabWidth
  if (tabLeft < scrollLeft || tabWidth > viewWidth) return tabLeft
  if (tabRight > scrollLeft + viewWidth) return tabRight - viewWidth
  return scrollLeft
}

/** Pixels per line for wheel events reported in lines (`deltaMode` 1). */
const LINE_PX = 40

/**
 * How far a wheel event over the strip should scroll it horizontally, or 0
 * to leave the event alone. A plain mouse wheel only reports `deltaY`, so
 * that is turned into horizontal scrolling; a touchpad's own horizontal
 * swipe (`deltaX` dominant) is already handled by the browser.
 */
export function wheelToScroll(deltaX: number, deltaY: number, deltaMode: number): number {
  if (deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return 0
  return deltaMode === 1 ? deltaY * LINE_PX : deltaY
}
