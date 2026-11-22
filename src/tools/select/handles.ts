import type { PageViewport } from 'pdfjs-dist'
import { annotationKinds } from '../../core/registry/annotationKinds'
import { rotateScreenPoint } from '../../core/geometry/rotation'
import { barAbove } from '../../core/viewer/cardPlacement'
import type { Annotation, Point, Rect } from '../../core/session/model'

/**
 * Resize handles of a selection box, named by compass direction on screen.
 * Handle geometry works in screen (viewport) space: rects are
 * [left, top, right, bottom] with y growing downwards, so 'n' is the top edge
 * whatever the page rotation.
 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const ALL_HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * How handles are drawn (screen px): corners are circles of HANDLE_RADIUS,
 * edges pills HANDLE_PILL long along their edge and HANDLE_PILL_WIDTH across.
 */
export const HANDLE_RADIUS = 4.5
export const HANDLE_PILL = 21
export const HANDLE_PILL_WIDTH = 6
/**
 * Screen pixels around a handle's centre that grab it. Along its edge a pill
 * grabs over its whole length (see handleAt), which is longer.
 */
export const HANDLE_TOLERANCE_PX = 6

/** Whether `h` is a corner (drawn as a circle) rather than an edge (a pill). */
export const isCorner = (h: Handle): boolean => h.length === 2
const WIDTH_HANDLES: readonly Handle[] = ['e', 'w']
const NO_HANDLES: readonly Handle[] = []

/** Handles a selected annotation offers: text boxes resize in width, ink, shapes, lines and images in any direction, highlights not at all. */
export function handlesFor(a: Annotation): readonly Handle[] {
  switch (a.kind) {
    case 'freetext':
      return WIDTH_HANDLES
    case 'ink':
    case 'shape':
    case 'line':
    case 'image':
      return ALL_HANDLES
    default:
      return NO_HANDLES
  }
}

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** Centre of handle `h` on the y-down rect `r`. */
export function handlePoint(r: Rect, h: Handle): Point {
  const [x1, y1, x2, y2] = r
  const x = h.includes('w') ? x1 : h.includes('e') ? x2 : (x1 + x2) / 2
  const y = h.includes('n') ? y1 : h.includes('s') ? y2 : (y1 + y2) / 2
  return [x, y]
}

/**
 * `r` (y-down) with the edges of handle `h` moved by dx/dy; an edge never
 * moves closer than `minSize` to the opposite edge (the opposite edge stays put).
 */
export function resizeRect(r: Rect, h: Handle, dx: number, dy: number, minSize: number): Rect {
  let [x1, y1, x2, y2] = r
  if (h.includes('w')) x1 = Math.min(x1 + dx, x2 - minSize)
  if (h.includes('e')) x2 = Math.max(x2 + dx, x1 + minSize)
  if (h.includes('n')) y1 = Math.min(y1 + dy, y2 - minSize)
  if (h.includes('s')) y2 = Math.max(y2 + dy, y1 + minSize)
  return [x1, y1, x2, y2]
}

/**
 * `r`, the result of dragging corner handle `h` of `box` (both y-down), with
 * the aspect ratio of `box`: scaled by the larger of the two factors, anchored
 * at the opposite corner, and at least `minSize` on both sides. Growing stops
 * where the box would leave `bounds`; that limit never forces it below its
 * current size (a box already reaching past an edge keeps its size), and it
 * does not apply when the anchor corner itself lies beyond that edge. Edge
 * handles return `r` unchanged.
 */
export function keepAspect(box: Rect, r: Rect, h: Handle, bounds: Rect, minSize: number): Rect {
  if (h.length !== 2) return r
  const w0 = box[2] - box[0]
  const h0 = box[3] - box[1]
  if (w0 <= 0 || h0 <= 0) return r
  const west = h.includes('w')
  const north = h.includes('n')
  const ax = west ? box[2] : box[0]
  const ay = north ? box[3] : box[1]
  /** Largest factor the room `d` (px) beyond the anchor allows. */
  const limit = (d: number, size: number) => (d <= 0 ? Infinity : Math.max(d / size, 1))
  const roomX = limit(west ? ax - bounds[0] : bounds[2] - ax, w0)
  const roomY = limit(north ? ay - bounds[1] : bounds[3] - ay, h0)
  const kMin = minSize / Math.min(w0, h0)
  const k = Math.max(kMin, Math.min(Math.max((r[2] - r[0]) / w0, (r[3] - r[1]) / h0), roomX, roomY))
  const w = w0 * k
  const hh = h0 * k
  const x1 = west ? ax - w : ax
  const y1 = north ? ay - hh : ay
  return [x1, y1, x1 + w, y1 + hh]
}

/**
 * The handle of `r` (y-down) whose centre is within `tolerancePt` of `p` on
 * both axes (the nearest when several are), among `allowed`; null if none.
 * Edge handles reach `edgeLength / 2` along their edge when that is more
 * (a long pill grabs over its whole length). Units are those of `r` and `p`.
 */
export function handleAt(
  r: Rect,
  p: Point,
  tolerancePt: number,
  allowed: readonly Handle[] = ALL_HANDLES,
  edgeLength = 0,
): Handle | null {
  let best: Handle | null = null
  let bestDist = Infinity
  const along = Math.max(tolerancePt, edgeLength / 2)
  for (const h of allowed) {
    const [hx, hy] = handlePoint(r, h)
    const ax = Math.abs(p[0] - hx)
    const ay = Math.abs(p[1] - hy)
    // n/s pills lie along x, e/w pills along y.
    const tx = h === 'n' || h === 's' ? along : tolerancePt
    const ty = h === 'e' || h === 'w' ? along : tolerancePt
    if (ax > tx || ay > ty) continue
    const d = Math.hypot(ax, ay)
    if (d < bestDist) {
      best = h
      bestDist = d
    }
  }
  return best
}

/** What a press on a selection box can grab: a resize handle or the rotate handle. */
export type Grab = Handle | 'rotate'

/** Screen px from the box edge to the rotate handle's centre (on a stem). */
export const ROTATE_STEM = 22
/** Radius (screen px) of the rotate handle's circle. */
export const ROTATE_RADIUS = 5

/** Cursor over the rotate handle and while rotating: a circular arrow, its hot spot in the middle. */
export const ROTATE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke="white" stroke-width="4"><path d="M18.5 9A7 7 0 1 0 19 13.5"/><path d="M19 4v5h-5"/></g>' +
      '<g stroke="black" stroke-width="1.8"><path d="M18.5 9A7 7 0 1 0 19 13.5"/><path d="M19 4v5h-5"/></g></svg>',
  )}") 12 12, crosshair`

/** Whether `a` can be turned with the rotate handle (not text markup, which follows its text). */
export const isRotatable = (a: Annotation): boolean => !!annotationKinds.get(a.kind).rotate

/**
 * A selection box on screen: `rect` (y-down) as without the turn, turned by
 * `angle` (degrees, counter-clockwise on screen) around its centre. Handles
 * sit on the turned box, in its own frame.
 */
export interface ScreenFrame {
  rect: Rect
  angle: number
}

/** The annotation's turn (degrees); 0 for kinds that have none (their points turn instead). */
export const turnAngle = (a: Annotation): number => ('rotation' in a ? (a.rotation ?? 0) : 0)

/**
 * The PDF box the selection frame of `a` stands for, as without its turn:
 * its bounds when not turned, else the bounds of the same annotation unturned.
 */
export function unturnedBounds(a: Annotation): Rect {
  const kind = annotationKinds.get(a.kind)
  return turnAngle(a) === 0 ? kind.bounds(a) : kind.bounds({ ...a, rotation: 0 } as Annotation)
}

/** The selection frame of `a` on screen (see ScreenFrame). */
export function selectionFrame(a: Annotation, vp: PageViewport): ScreenFrame {
  return { rect: toScreenRect(unturnedBounds(a), vp), angle: turnAngle(a) }
}

export const frameCentre = (f: ScreenFrame): Point => [(f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2]

/** The screen point `p` in the frame's own (unturned) coordinates. */
export function intoFrame(f: ScreenFrame, p: Point): Point {
  return f.angle === 0 ? p : rotateScreenPoint(p, frameCentre(f), -f.angle)
}

/** The frame's own point `p` on screen (turned with the frame). */
export function outOfFrame(f: ScreenFrame, p: Point): Point {
  return f.angle === 0 ? p : rotateScreenPoint(p, frameCentre(f), f.angle)
}

/** Screen bounds (y-down) of the turned frame. */
export function frameBounds(f: ScreenFrame): Rect {
  if (f.angle === 0) return f.rect
  const [x1, y1, x2, y2] = f.rect
  const pts = ([[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as Point[]).map((p) => outOfFrame(f, p))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The rotate handle of the frame `f`, in the frame's own coordinates: its
 * centre (`at`) on a stem from the middle of the bottom or top edge (`from`).
 * It goes on the side of the selection away from the selection bar (see
 * barAbove), so the bar never covers it: below the box, or above it when the
 * bar has to go below. Of a turned box, the end lowest (or highest) on screen.
 */
export function rotateHandlePoint(f: ScreenFrame): { at: Point; from: Point } {
  const [x1, y1, x2, y2] = f.rect
  const cx = (x1 + x2) / 2
  const bottom = { at: [cx, y2 + ROTATE_STEM] as Point, from: [cx, y2] as Point }
  const top = { at: [cx, y1 - ROTATE_STEM] as Point, from: [cx, y1] as Point }
  const yBottom = outOfFrame(f, bottom.at)[1]
  const yTop = outOfFrame(f, top.at)[1]
  return barAbove(frameBounds(f)) ? (yBottom >= yTop ? bottom : top) : yTop <= yBottom ? top : bottom
}

/**
 * What the screen point `p` grabs on the frame `f`: the rotate handle (when
 * `rotatable`), else one of `allowed` (see handleAt); null if nothing.
 */
export function grabAt(
  f: ScreenFrame,
  p: Point,
  tolerancePx: number,
  allowed: readonly Handle[],
  rotatable: boolean,
  edgeLength = 0,
): Grab | null {
  const q = intoFrame(f, p)
  if (rotatable) {
    const [hx, hy] = rotateHandlePoint(f).at
    if (Math.hypot(q[0] - hx, q[1] - hy) <= ROTATE_RADIUS + tolerancePx) return 'rotate'
  }
  return handleAt(f.rect, q, tolerancePx, allowed, edgeLength)
}

/** Direction (degrees, counter-clockwise from screen right) of each handle from the box centre. */
const HANDLE_DIRECTION: Record<Handle, number> = { e: 0, ne: 45, n: 90, nw: 135, w: 180, sw: 225, s: 270, se: 315 }
const DIRECTION_CURSORS = ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize']

/** The cursor of `g` on a frame turned by `angle`: the resize arrow nearest to the handle's turned direction. */
export function grabCursor(g: Grab, angle = 0): string {
  if (g === 'rotate') return ROTATE_CURSOR
  if (angle === 0) return HANDLE_CURSORS[g]
  const d = (((HANDLE_DIRECTION[g] + angle) % 180) + 180) % 180
  return DIRECTION_CURSORS[Math.round(d / 45) % 4]
}

/** Screen (viewport) rect, y-down, of the PDF rect `r`: axis-aligned for any page rotation. */
export function toScreenRect(r: Rect, vp: PageViewport): Rect {
  const [ax, ay] = vp.convertToViewportPoint(r[0], r[1])
  const [bx, by] = vp.convertToViewportPoint(r[2], r[3])
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

/** PDF rect (x1 < x2, y1 < y2) of the screen rect `r`. */
export function toPdfRect(r: Rect, vp: PageViewport): Rect {
  const [ax, ay] = vp.convertToPdfPoint(r[0], r[1])
  const [bx, by] = vp.convertToPdfPoint(r[2], r[3])
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

/** Whether `p` lies inside the rect `r` (any y direction, boundary included). */
export function inRect(r: Rect, p: Point): boolean {
  return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
}
