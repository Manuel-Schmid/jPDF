import type { PageViewport } from 'pdfjs-dist'
import type { PageFrame } from '../../core/registry/tools'
import type { Point } from '../../core/session/model'

/** The parts of a stroke drawn on one page other than the one it started on. */
export interface AwayStrokes {
  strokes: Point[][]
  /** One array per stroke; null for a stroke recorded without pressure. */
  pressure: number[][] | null
}

export interface PageHandoff {
  /**
   * Adds the next pointer position: `client` px, the home page's top-left
   * corner in client px now (`homeOrigin`, follows scrolling) and the point
   * in the home page's PDF space (as the home page already records it).
   */
  add(client: Point, homeOrigin: Point, homePdf: Point, pressure: number): void
  /** The strokes drawn on other pages so far, by page (0-based). */
  readonly away: ReadonlyMap<number, AwayStrokes>
  /** The viewport of a page the stroke went onto (set for every key of `away`). */
  viewport(page: number): PageViewport | null
}

interface CachedFrame {
  vp: PageViewport
  /** The page's origin minus the home page's origin, in client px (fixed while scrolling). */
  offset: Point
}

const inBox = (p: Point, vp: PageViewport): boolean => {
  const [a, b, c, d] = vp.viewBox
  return (
    p[0] >= Math.min(a, c) &&
    p[0] <= Math.max(a, c) &&
    p[1] >= Math.min(b, d) &&
    p[1] <= Math.max(b, d)
  )
}

/**
 * Follows a freehand stroke onto other pages. A PDF annotation lives on one
 * page, so when the pointer enters a neighbouring page the stroke continues
 * there as a new stroke, starting from the last point before it (outside
 * that page, so clipping later puts the start exactly on its edge). Coming
 * back to the home page continues there: the home page keeps every point
 * itself and is clipped on its own.
 *
 * Work per point: one box test against the page the pointer is on. Other
 * pages are looked up only while the pointer is outside it, each at most once
 * per stroke (cached relative to the home page, so scrolling needs no new
 * lookup).
 */
export function createPageHandoff(
  home: number,
  homeVp: PageViewport,
  frameOf: (page: number) => PageFrame | null,
  withPressure: boolean,
): PageHandoff {
  const away = new Map<number, AwayStrokes>()
  const frames = new Map<number, CachedFrame | null>()
  /** The page the stroke is on now. */
  let at = home
  let cur: Point[] | null = null
  let curP: number[] | null = null
  let prev: { client: Point; pressure: number } | null = null

  function frame(page: number, homeOrigin: Point): CachedFrame | null {
    if (!frames.has(page)) {
      const f = page < 0 ? null : frameOf(page)
      frames.set(
        page,
        f && { vp: f.vp, offset: [f.origin[0] - homeOrigin[0], f.origin[1] - homeOrigin[1]] },
      )
    }
    return frames.get(page)!
  }

  const toPdf = (f: CachedFrame, client: Point, homeOrigin: Point): Point => {
    const [x, y] = f.vp.convertToPdfPoint(
      client[0] - homeOrigin[0] - f.offset[0],
      client[1] - homeOrigin[1] - f.offset[1],
    )
    return [x, y]
  }

  return {
    away,
    viewport: (page) => frames.get(page)?.vp ?? null,
    add(client, homeOrigin, homePdf, pressure) {
      const p = prev
      prev = { client, pressure }
      if (at === home) {
        if (!p || inBox(homePdf, homeVp)) return
      } else {
        const f = frames.get(at)!
        const pdf = toPdf(f, client, homeOrigin)
        cur!.push(pdf)
        curP?.push(pressure)
        if (inBox(pdf, f.vp)) return
        if (inBox(homePdf, homeVp)) {
          at = home
          return
        }
      }
      // Outside the page it is on: did it enter a neighbour?
      for (const q of [at - 1, at + 1]) {
        if (q === home) continue
        const f = frame(q, homeOrigin)
        if (!f) continue
        const pdf = toPdf(f, client, homeOrigin)
        if (!inBox(pdf, f.vp)) continue
        at = q
        let entry = away.get(q)
        if (!entry) away.set(q, (entry = { strokes: [], pressure: withPressure ? [] : null }))
        cur = [toPdf(f, p!.client, homeOrigin), pdf]
        entry.strokes.push(cur)
        curP = withPressure ? [p!.pressure, pressure] : null
        if (curP) entry.pressure!.push(curP)
        return
      }
    },
  }
}
