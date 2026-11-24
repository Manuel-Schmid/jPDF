export const PAGE_GAP = 16, MIN_SCALE = 0.1, MAX_SCALE = 8;

export interface Layout {
  tops: number[];
  heights: number[];
  /** Height below each page before the next gap (its explanation field; 0 for none). */
  extras: number[];
  widths: number[];
  totalHeight: number;
  maxWidth: number;
}

/**
 * Page positions at `scale`. `extras[i]` (screen pixels, not scaled) is
 * added below page i, before the next gap: room for its explanation field.
 */
export function computeLayout(
  sizes: { width: number; height: number }[], scale: number, extras: readonly number[] = [],
): Layout {
  const tops: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  const below: number[] = [];
  let y = PAGE_GAP;
  let maxWidth = 0;
  sizes.forEach((s, i) => {
    const w = s.width * scale;
    const h = s.height * scale;
    const extra = extras[i] ?? 0;
    tops.push(y);
    heights.push(h);
    widths.push(w);
    below.push(extra);
    if (w > maxWidth) maxWidth = w;
    y += h + extra + PAGE_GAP;
  });
  return { tops, heights, extras: below, widths, totalHeight: y, maxWidth };
}

/** Smallest index in [0, n] for which pred is true (pred must be monotonic). */
function lowerBound(n: number, pred: (i: number) => boolean): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export function visibleRange(
  l: Layout, scrollTop: number, viewportH: number, overscan = 1,
): { first: number; last: number } {
  const n = l.tops.length;
  if (n === 0) return { first: 0, last: -1 };
  const bottom = scrollTop + viewportH;
  // A page counts as visible while its field below it is (they mount together).
  const first = Math.min(n - 1, lowerBound(n, (i) => l.tops[i] + l.heights[i] + (l.extras[i] ?? 0) >= scrollTop));
  const last = Math.max(0, lowerBound(n, (i) => l.tops[i] > bottom) - 1);
  return { first: Math.max(0, first - overscan), last: Math.min(n - 1, last + overscan) };
}

export function pageAt(l: Layout, y: number): number {
  const n = l.tops.length;
  if (n === 0) return 0;
  const idx = lowerBound(n, (i) => l.tops[i] - PAGE_GAP / 2 > y) - 1;
  return Math.max(0, Math.min(n - 1, idx));
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function fitWidthScale(maxPageWidthPt: number, containerW: number): number {
  return clampScale((containerW - 2 * PAGE_GAP) / maxPageWidthPt);
}

/**
 * Scale for a document's first display, from its first page. Landscape pages
 * fit the width so they fill the view; portrait pages fit whole (never larger
 * than fit width), so the opening view shows the full first page instead of a
 * blown-up top slice.
 */
export function initialScale(
  first: { width: number; height: number }, containerW: number, containerH: number,
): number {
  const fitW = fitWidthScale(first.width, containerW);
  if (first.height <= first.width) return fitW;
  return Math.min(fitW, clampScale((containerH - 2 * PAGE_GAP) / first.height));
}

export function contentWidth(l: Layout, containerW: number): number {
  return Math.max(containerW, l.maxWidth + 2 * PAGE_GAP);
}

export function pageLeft(l: Layout, i: number, containerW: number): number {
  return (contentWidth(l, containerW) - l.widths[i]) / 2;
}

export function zoomAround(
  l0: Layout, l1: Layout, s0: number, s1: number,
  anchor: { x: number; y: number }, scroll: { top: number; left: number }, containerW: number,
): { top: number; left: number } {
  if (l0.tops.length === 0 || l1.tops.length === 0) return { top: scroll.top, left: scroll.left };
  const cx = scroll.left + anchor.x;
  const cy = scroll.top + anchor.y;
  const i = pageAt(l0, cy);
  const offX = (cx - pageLeft(l0, i, containerW)) / s0;
  const nx = pageLeft(l1, i, containerW) + offX * s1;
  // Below the page (on its field, which does not scale): keep the distance
  // from the page's bottom edge.
  const bottom0 = l0.tops[i] + l0.heights[i];
  const ny = cy > bottom0
    ? l1.tops[i] + l1.heights[i] + (cy - bottom0)
    : l1.tops[i] + ((cy - l0.tops[i]) / s0) * s1;
  return { top: Math.max(0, ny - anchor.y), left: Math.max(0, nx - anchor.x) };
}
