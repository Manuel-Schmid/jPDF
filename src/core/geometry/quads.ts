import type { Point, Quad } from '../session/model'

/** A client-space rectangle (e.g. from Range.getClientRects()). */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Same-line fragments at most this far apart horizontally are merged. */
const MAX_GAP_PX = 4

const centre = (r: ScreenRect) => (r.top + r.bottom) / 2

const height = (r: ScreenRect) => r.bottom - r.top

/** Maximum horizontal gap between two rects, or a per-pair limit function. */
export type GapLimit = number | ((a: ScreenRect, b: ScreenRect) => number)

/** Whether two rects lie on the same line within `tol`, `maxGap`, and optional `heightRatio`. */
export function rectsJoinable(
  a: ScreenRect,
  b: ScreenRect,
  tol: number,
  maxGap: GapLimit,
  heightRatio?: number,
): boolean {
  const gap = typeof maxGap === 'function' ? maxGap(a, b) : maxGap
  return (
    Math.abs(centre(a) - centre(b)) <= tol &&
    b.left - a.right <= gap &&
    a.left - b.right <= gap &&
    (heightRatio === undefined || Math.abs(height(a) - height(b)) <= heightRatio * Math.max(height(a), height(b)))
  )
}

function union(a: ScreenRect, b: ScreenRect): ScreenRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }
}

/**
 * Merges rects on one line (vertical centres within `lineTolerance`,
 * horizontal gap ≤ `maxGap`, overlaps included) into one rect per line
 * fragment, repeating until no two fragments join. Result sorted top to
 * bottom, left to right. With `heightRatio`, rects join only if their
 * heights differ by at most that fraction of the taller one. Shared by
 * selection rects (rectsToQuads) and saved highlight quads (merge.ts).
 */
export function mergeLineRects(
  rects: ScreenRect[],
  lineTolerance: number,
  maxGap: GapLimit,
  heightRatio?: number,
): ScreenRect[] {
  const merged: ScreenRect[] = []
  for (const r of rects.slice().sort((a, b) => a.left - b.left)) {
    const i = merged.findIndex((m) => rectsJoinable(m, r, lineTolerance, maxGap, heightRatio))
    if (i >= 0) merged[i] = union(merged[i], r)
    // Copy the edges explicitly: DOMRect keeps them as prototype getters, so `{ ...r }` would be empty.
    else merged.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  // A merge can widen a fragment until it reaches another one.
  for (let changed = true; changed; ) {
    changed = false
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (rectsJoinable(merged[i], merged[j], lineTolerance, maxGap, heightRatio)) {
          merged[i] = union(merged[i], merged[j])
          merged.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return merged.sort((a, b) => a.top - b.top || a.left - b.left)
}

/**
 * Selection rects → highlight quads: drops rects under 1px wide or high, merges
 * rects on one line (vertical centres within `lineTolerancePx`, horizontal gap
 * ≤ 4px) into one rect per line fragment, and maps the corners to PDF space in
 * QuadPoints order TL, TR, BL, BR. Quads come out top to bottom, left to right.
 */
export function rectsToQuads(
  rects: ScreenRect[],
  toPdf: (x: number, y: number) => Point,
  lineTolerancePx = 3,
): Quad[] {
  const visible = rects.filter((r) => r.right - r.left >= 1 && r.bottom - r.top >= 1)
  return mergeLineRects(visible, lineTolerancePx, MAX_GAP_PX).map((r) => {
    const tl = toPdf(r.left, r.top)
    const tr = toPdf(r.right, r.top)
    const bl = toPdf(r.left, r.bottom)
    const br = toPdf(r.right, r.bottom)
    return [tl[0], tl[1], tr[0], tr[1], bl[0], bl[1], br[0], br[1]]
  })
}

/** Quad outline in drawing order TL, TR, BR, BL (QuadPoints order is TL, TR, BL, BR). */
export function quadOutline(q: Quad): Point[] {
  return [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ]
}
