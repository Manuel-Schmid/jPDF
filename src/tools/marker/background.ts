import type { Point } from '../../core/session/model'
import type { ScreenRect } from '../../core/geometry/quads'

/**
 * Dark-background detection for the marker: multiply blending (the default)
 * makes a bright stripe on white paper but nearly vanishes on a dark page
 * (colour × dark ≈ dark), so marks made on a dark background are drawn
 * normal-blended at reduced opacity instead.
 *
 * Reads the page's rendered `<canvas>`: the PDF's own pixels, before the CSS
 * filter of dark page colours (a white page shown dark stays multiply). Only a
 * few tiny patches are read, once per mark (pointerdown / commit), never while
 * drawing or rendering.
 */

/** A patch whose median luminance (0..1) is below this counts as dark. */
export const DARK_LUMINANCE = 0.35
/**
 * Share of dark patches from which a mark counts as made on a dark
 * background. Well below one half, so a mark across a dark-to-light boundary
 * stays visible on its dark part (normal blend still shows on the light
 * part). Black text on white paper rarely darkens a patch's median (see
 * PATCH_CSS_PX), so light pages stay multiply.
 */
export const DARK_SHARE = 1 / 4
/** Opacity factor for marks on a dark background (normal blend over light text). */
export const DARK_OPACITY_FACTOR = 0.4
/** Most patches read per mark. */
export const MAX_SAMPLES = 16
/**
 * Patch edge (CSS px; canvas px follow the render scale, 3..16): its median
 * is the background unless glyph ink covers most of the patch.
 */
export const PATCH_CSS_PX = 6

/** Relative luminance of 8-bit sRGB values (Rec. 709 weights), 0..1. */
export const luminance = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Median luminance of RGBA pixels. */
export function medianLuminance(rgba: ArrayLike<number>): number {
  const l: number[] = []
  for (let i = 0; i + 3 < rgba.length; i += 4) l.push(luminance(rgba[i], rgba[i + 1], rgba[i + 2]))
  if (l.length === 0) return 1
  l.sort((a, b) => a - b)
  return l[l.length >> 1]
}

/** Whether patches of these median luminances make a dark background (none: no). */
export function isDarkBackground(patches: readonly number[]): boolean {
  if (patches.length === 0) return false
  const dark = patches.filter((l) => l < DARK_LUMINANCE).length
  return dark / patches.length >= DARK_SHARE
}

/** At most `max` items, evenly spread over `items` (first and last kept). */
export function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice()
  if (max <= 1) return items.slice(0, max)
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))])
  return out
}

/** Sample points (client px) inside text line boxes: background between glyphs, upper part and middle. */
export function rectSamples(rects: readonly ScreenRect[]): Point[] {
  const out: Point[] = []
  for (const r of rects) {
    const w = r.right - r.left
    const h = r.bottom - r.top
    if (w <= 0 || h <= 0) continue
    for (const v of [0.2, 0.5])
      for (const u of [0.25, 0.75]) out.push([r.left + u * w, r.top + v * h])
  }
  return out
}

/**
 * Sample points (client px) for a stroke of width `r * 2`: each point and
 * the band's upper and lower edge beside it, where there is more background
 * than on the text a marker runs along.
 */
export function bandSamples(points: readonly Point[], r: number): Point[] {
  const d = r * 0.8
  return points.flatMap(([x, y]): Point[] => [
    [x, y - d],
    [x, y],
    [x, y + d],
  ])
}

/** The rendered canvas of a page element (its direct child), if any. */
export function canvasOf(page: Element | null | undefined): HTMLCanvasElement | null {
  const c = page?.querySelector(':scope > canvas')
  return c instanceof HTMLCanvasElement ? c : null
}

/** The rendered canvas of the page under client point (x, y), if any. */
export function pageCanvasAt(x: number, y: number): HTMLCanvasElement | null {
  if (
    typeof document.elementsFromPoint !== 'function' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    return null
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLCanvasElement && el.parentElement && canvasOf(el.parentElement) === el)
      return el
    const c = canvasOf(el)
    if (c) return c
  }
  return null
}

/**
 * Whether `canvas` is dark under the client points (at most MAX_SAMPLES of
 * them, a PATCH_CSS_PX square each). Null when nothing could be read: no canvas or
 * 2D context, or every point off the canvas.
 */
export function sampleDark(
  canvas: HTMLCanvasElement | null,
  points: readonly Point[],
): boolean | null {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null
  const box = canvas.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!ctx) return null
  const sx = canvas.width / box.width
  const sy = canvas.height / box.height
  const size = Math.min(16, Math.max(3, Math.round(PATCH_CSS_PX * sx)), canvas.width, canvas.height)
  const half = size >> 1
  const patches: number[] = []
  for (const [cx, cy] of spread(points, MAX_SAMPLES)) {
    const x = Math.floor((cx - box.left) * sx)
    const y = Math.floor((cy - box.top) * sy)
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue
    const px = Math.min(Math.max(0, x - half), canvas.width - size)
    const py = Math.min(Math.max(0, y - half), canvas.height - size)
    try {
      patches.push(medianLuminance(ctx.getImageData(px, py, size, size).data))
    } catch {
      return null
    }
  }
  return patches.length === 0 ? null : isDarkBackground(patches)
}

/** Blend and opacity of a mark with set `opacity`, on a dark background or not. */
export function markStyle(
  dark: boolean,
  opacity: number,
): { blend: 'normal' | 'multiply'; opacity: number } {
  return dark
    ? { blend: 'normal', opacity: opacity * DARK_OPACITY_FACTOR }
    : { blend: 'multiply', opacity }
}
