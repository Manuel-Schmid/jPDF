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

/**
 * How far to scroll so the page at the top of the view (at `scrollTop` in
 * `before`) stays in place after only the extras (explanation fields)
 * changed: a field appearing above the page being read would otherwise push
 * it down. 0 when pages or their heights changed (page operations, zoom and
 * late page sizes keep their own scroll handling).
 */
export function anchorShift(before: Layout, after: Layout, scrollTop: number): number {
  const n = before.tops.length;
  if (n === 0 || after.tops.length !== n) return 0;
  for (let i = 0; i < n; i++) if (before.heights[i] !== after.heights[i]) return 0;
  const p = pageAt(before, scrollTop);
  return after.tops[p] - before.tops[p];
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

/**
 * Margin (screen pixels) above and below a page fitted by fitPageScale: thin,
 * so a slide is as large as possible. The neighbouring pages, a PAGE_GAP
 * away, stay out of view.
 */
export const FIT_MARGIN = 4;

/**
 * Largest scale at which a page and its explanation field (`extra` screen
 * pixels below it, see fieldExtra) fit whole in the viewport, with FIT_MARGIN
 * above and below them and PAGE_GAP at the sides (the content keeps PAGE_GAP
 * beside the widest page: less would add a horizontal scrollbar). The
 * field's width never matters: fieldBox keeps it inside the content width.
 */
export function fitPageScale(
  page: { width: number; height: number }, extra: number, containerW: number, containerH: number,
): number {
  return clampScale(Math.min(
    (containerW - 2 * PAGE_GAP) / page.width,
    (containerH - 2 * FIT_MARGIN - extra) / page.height,
  ));
}

/**
 * Scroll position that centres page `i` and its field in the viewport
 * (clamped to the scrollable range), as fitPage shows it.
 */
export function centredScroll(
  l: Layout, i: number, containerW: number, containerH: number,
): { top: number; left: number } {
  const block = l.heights[i] + l.extras[i];
  const maxTop = Math.max(0, l.totalHeight - containerH);
  const top = Math.min(maxTop, Math.max(0, l.tops[i] + (block - containerH) / 2));
  const maxLeft = Math.max(0, contentWidth(l, containerW) - containerW);
  const left = Math.min(maxLeft, Math.max(0, pageLeft(l, i, containerW) - (containerW - l.widths[i]) / 2));
  return { top, left };
}

/**
 * A page flip's start transform (on the pages, origin 0 0: z -> a*z + (x, y)).
 * The flip commits the new layout `to` and scroll `toScroll` at once; this
 * transform makes that view look like the one before it (`from` at
 * `fromScroll`) around page `i`. Easing it to none animates the flip, zoom
 * change included, while pages render once at the final zoom (until then the
 * old drawing is stretched).
 */
export function flipTransform(
  from: Layout, fromScroll: { top: number; left: number },
  to: Layout, toScroll: { top: number; left: number },
  i: number, containerW: number,
): { a: number; x: number; y: number } {
  const a = from.widths[i] / to.widths[i];
  const x = pageLeft(from, i, containerW) - fromScroll.left - a * pageLeft(to, i, containerW) + toScroll.left;
  const y = from.tops[i] - fromScroll.top - a * to.tops[i] + toScroll.top;
  return { a, x, y };
}

/** True when page `i` and its field are entirely inside the viewport at `scroll` (1 px slack for rounding). */
export function pageFullyVisible(
  l: Layout, i: number, scroll: { top: number; left: number }, containerW: number, containerH: number,
): boolean {
  const top = l.tops[i], bottom = top + l.heights[i] + l.extras[i];
  const left = pageLeft(l, i, containerW), right = left + l.widths[i];
  return top >= scroll.top - 1 && bottom <= scroll.top + containerH + 1
    && left >= scroll.left - 1 && right <= scroll.left + containerW + 1;
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
