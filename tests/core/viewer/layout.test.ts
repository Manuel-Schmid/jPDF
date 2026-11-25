import { describe, it, expect } from 'vitest';
import {
  computeLayout, visibleRange, pageAt, clampScale, fitWidthScale, initialScale, zoomAround,
  contentWidth, pageLeft, PAGE_GAP, anchorShift, fitPageScale, centredScroll, pageFullyVisible, flipTransform,
} from '../../../src/core/viewer/layout';

const two = [{ width: 600, height: 800 }, { width: 600, height: 800 }];

describe('computeLayout', () => {
  it('stacks pages with gaps', () => {
    const l = computeLayout(two, 1);
    expect(l.tops).toEqual([16, 832]);
    expect(l.totalHeight).toBe(1648);
    expect(l.maxWidth).toBe(600);
  });
  it('scales', () => {
    const l = computeLayout(two, 0.5);
    expect(l.tops).toEqual([16, 432]);
    expect(l.heights).toEqual([400, 400]);
  });
  it('respects rotated page sizes', () => {
    const l = computeLayout([{ width: 842, height: 595 }], 1);
    expect(l.heights[0]).toBe(595);
    expect(l.widths[0]).toBe(842);
  });
  it('handles zero pages', () => {
    const l = computeLayout([], 1);
    expect(l.tops).toEqual([]);
    expect(visibleRange(l, 0, 500)).toEqual({ first: 0, last: -1 });
    expect(pageAt(l, 100)).toBe(0);
  });
});

describe('visibleRange', () => {
  const l = computeLayout(two, 1);
  it('overscan 0', () => expect(visibleRange(l, 900, 500, 0)).toEqual({ first: 1, last: 1 }));
  it('overscan 1', () => expect(visibleRange(l, 900, 500, 1)).toEqual({ first: 0, last: 1 }));
  it('clamps at the ends', () => {
    expect(visibleRange(l, 0, 100, 5)).toEqual({ first: 0, last: 1 });
  });
});

describe('pageAt', () => {
  const l = computeLayout(two, 1);
  it('finds pages incl. half gaps', () => {
    expect(pageAt(l, 0)).toBe(0);
    expect(pageAt(l, 500)).toBe(0);
    expect(pageAt(l, 819)).toBe(0);
    expect(pageAt(l, 825)).toBe(1);
    expect(pageAt(l, 99999)).toBe(1);
    expect(pageAt(l, -50)).toBe(0);
  });
});

describe('scale helpers', () => {
  it('clampScale', () => {
    expect(clampScale(20)).toBe(8);
    expect(clampScale(0.01)).toBe(0.1);
    expect(clampScale(1.5)).toBe(1.5);
  });
  it('fitWidthScale', () => {
    expect(fitWidthScale(600, 1232)).toBe(2);
    expect(fitWidthScale(600, 10)).toBe(0.1);
  });
  it('initialScale fits portrait pages whole and landscape pages to the width', () => {
    // Portrait: height limits (800 - 32) / 1000 = 0.768, below fit width 2.
    expect(initialScale({ width: 600, height: 1000 }, 1232, 800)).toBeCloseTo(0.768);
    // Portrait in a narrow window: fit width is already the smaller one.
    expect(initialScale({ width: 600, height: 800 }, 332, 2000)).toBeCloseTo(0.5);
    // Landscape: always fit width, even if that overflows the height.
    expect(initialScale({ width: 600, height: 400 }, 1232, 300)).toBe(2);
  });
});

describe('horizontal geometry', () => {
  it('centres pages', () => {
    const l = computeLayout([{ width: 600, height: 800 }, { width: 400, height: 800 }], 1);
    expect(contentWidth(l, 1000)).toBe(1000);
    expect(contentWidth(l, 300)).toBe(632);
    expect(pageLeft(l, 0, 1000)).toBe(200);
    expect(pageLeft(l, 1, 1000)).toBe(300);
  });
});

describe('zoomAround', () => {
  const sizes = [{ width: 600, height: 800 }, { width: 600, height: 800 }, { width: 600, height: 800 }];
  function docPoint(s: number, scroll: { top: number; left: number }, a: { x: number; y: number }, cw: number) {
    const l = computeLayout(sizes, s);
    const cy = scroll.top + a.y, cx = scroll.left + a.x;
    const i = pageAt(l, cy);
    return { i, y: (cy - l.tops[i]) / s, x: (cx - pageLeft(l, i, cw)) / s };
  }
  it('keeps the point under the anchor fixed', () => {
    const cw = 1000, a = { x: 500, y: 100 };
    const s0 = 1, s1 = 2;
    const before = docPoint(s0, { top: 0, left: 0 }, a, cw);
    const r = zoomAround(computeLayout(sizes, s0), computeLayout(sizes, s1), s0, s1, a, { top: 0, left: 0 }, cw);
    const after = docPoint(s1, r, a, cw);
    expect(after.i).toBe(before.i);
    expect(Math.abs(after.y - before.y) * s1).toBeLessThan(0.5);
    expect(Math.abs(after.x - before.x) * s1).toBeLessThan(0.5);
  });
  it('works mid-document and when zooming out', () => {
    const cw = 800, a = { x: 400, y: 300 }, scroll = { top: 1500, left: 0 };
    const s0 = 2, s1 = 0.5;
    const before = docPoint(s0, scroll, a, cw);
    const r = zoomAround(computeLayout(sizes, s0), computeLayout(sizes, s1), s0, s1, a, scroll, cw);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left).toBeGreaterThanOrEqual(0);
    const after = docPoint(s1, r, a, cw);
    if (r.top > 0) expect(Math.abs(after.y - before.y) * s1).toBeLessThan(0.5);
  });
  it('clamps negative scroll to 0', () => {
    const l0 = computeLayout(sizes, 2), l1 = computeLayout(sizes, 1);
    const r = zoomAround(l0, l1, 2, 1, { x: 0, y: 0 }, { top: 0, left: 0 }, 1000);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left).toBeGreaterThanOrEqual(0);
  });
  it('exports PAGE_GAP', () => expect(PAGE_GAP).toBe(16));
});

describe('anchorShift', () => {
  const sizes = [two[0], two[0], two[0], two[0]];
  it('follows the page at the top of the view when a field above it grows', () => {
    const before = computeLayout(sizes, 1);
    const after = computeLayout(sizes, 1, [0, 150, 0, 0]);
    // Scrolled into page 3 (index 2): page 2's new field pushes it down by 150.
    expect(anchorShift(before, after, before.tops[2] + 100)).toBe(150);
  });
  it('ignores fields below the page at the top', () => {
    const before = computeLayout(sizes, 1);
    const after = computeLayout(sizes, 1, [0, 0, 150, 150]);
    expect(anchorShift(before, after, before.tops[2] + 100)).toBe(0);
  });
  it('leaves page changes and zoom to their own handling', () => {
    const before = computeLayout(sizes, 1);
    expect(anchorShift(before, computeLayout(sizes.slice(1), 1), 900)).toBe(0);
    expect(anchorShift(before, computeLayout(sizes, 2), 900)).toBe(0);
  });
});

describe('page fit (arrow-key flips)', () => {
  it('fitPageScale fits the page whole, limited by height or width', () => {
    // Portrait in a wide view: height limits.
    expect(fitPageScale({ width: 600, height: 800 }, 0, 2000, 832)).toBe(1);
    // Landscape in a tall view: width limits.
    expect(fitPageScale({ width: 800, height: 600 }, 0, 832, 2000)).toBe(1);
  });

  it('fitPageScale leaves room for the explanation field below the page', () => {
    expect(fitPageScale({ width: 600, height: 800 }, 150, 2000, 982)).toBe(1);
    // The field takes height only: a width-limited page keeps its scale.
    expect(fitPageScale({ width: 800, height: 600 }, 150, 832, 2000)).toBe(1);
  });

  it('fitPageScale clamps', () => {
    expect(fitPageScale({ width: 1, height: 1 }, 0, 10000, 10000)).toBe(8);
  });

  it('centredScroll centres the page and its field', () => {
    const l = computeLayout([{ width: 600, height: 800 }, { width: 600, height: 400 }, { width: 600, height: 800 }], 1, [0, 100, 0]);
    // Page 2: top 832, block 500, view 700 high -> top 832 + (500 - 700) / 2.
    expect(centredScroll(l, 1, 1000, 700)).toEqual({ top: 732, left: 0 });
  });

  it('centredScroll clamps at the start and end of the document', () => {
    const l = computeLayout(two, 1);
    expect(centredScroll(l, 0, 1000, 1200).top).toBe(0);
    expect(centredScroll(l, 1, 1000, 1200).top).toBe(l.totalHeight - 1200);
  });

  it('centredScroll centres a narrow page horizontally among wider ones', () => {
    const l = computeLayout([{ width: 2000, height: 800 }, { width: 600, height: 800 }], 1);
    const { left } = centredScroll(l, 1, 1000, 900);
    expect(left + 1000 / 2).toBeCloseTo(pageLeft(l, 1, 1000) + 300);
  });

  it('pageFullyVisible needs the page and its field inside the view', () => {
    const l = computeLayout(two, 1, [50, 0]);
    expect(pageFullyVisible(l, 0, { top: 0, left: 0 }, 1000, 900)).toBe(true);
    expect(pageFullyVisible(l, 0, { top: 0, left: 0 }, 1000, 850)).toBe(false);
    expect(pageFullyVisible(l, 0, { top: 20, left: 0 }, 1000, 900)).toBe(false);
    expect(pageFullyVisible(l, 0, { top: 0, left: 0 }, 500, 900)).toBe(false);
  });

  it('flipTransform makes the new view look like the old one around the page', () => {
    const sizes = [{ width: 600, height: 800 }, { width: 400, height: 500 }, { width: 600, height: 800 }];
    const from = computeLayout(sizes, 1, [0, 38, 0]);
    const to = computeLayout(sizes, 1.5, [0, 38, 0]);
    const fromScroll = { top: 300, left: 0 };
    const toScroll = centredScroll(to, 1, 1000, 800);
    const t = flipTransform(from, fromScroll, to, toScroll, 1, 1000);
    expect(t.a).toBeCloseTo(1 / 1.5);
    // A point on page 1 (u, v pt from its corner) lands where it was on screen.
    const [u, v] = [100, 200];
    const after = { x: pageLeft(to, 1, 1000) + u * 1.5, y: to.tops[1] + v * 1.5 };
    const shown = { x: t.a * after.x + t.x - toScroll.left, y: t.a * after.y + t.y - toScroll.top };
    expect(shown.x).toBeCloseTo(pageLeft(from, 1, 1000) + u - fromScroll.left);
    expect(shown.y).toBeCloseTo(from.tops[1] + v - fromScroll.top);
  });
});
