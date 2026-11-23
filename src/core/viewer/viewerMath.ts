import type { PageViewport } from 'pdfjs-dist'
import type { Point } from '../session/model'
import { clampScale } from './layout'

/** Where a page was right-clicked: the point in PDF space and the page's viewport. */
export interface PageMenuPoint {
  pdf: Point
  vp: PageViewport
  /** The click was on the selection (the tool selected what was under it): offer its actions. */
  onSelection?: boolean
}

/**
 * Client coordinates → PDF user space for a page box at `box` (client rect of
 * the element covering the page) drawn with viewport `v`. The box can be
 * CSS-scaled (zoom preview) relative to the viewport units.
 */
export function clientToPdf(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  v: PageViewport,
): Point {
  const kx = box.width > 0 ? v.width / box.width : 1
  const ky = box.height > 0 ? v.height / box.height : 1
  const [px, py] = v.convertToPdfPoint((clientX - box.left) * kx, (clientY - box.top) * ky)
  return [px, py]
}

/** Largest canvas we render (width * height in device pixels). */
export const MAX_CANVAS_PIXELS = 16_777_216

/**
 * Device-pixel scale to render a page of `pageW` x `pageH` points at:
 * `scale * dpr`, reduced so a canvas of floor(pageW * rs) x floor(pageH * rs)
 * stays within MAX_CANVAS_PIXELS (the page is then CSS-scaled up), and
 * quantised with scaleBucket.
 */
export function renderScale(pageW: number, pageH: number, scale: number, dpr: number): number {
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH))
  return scaleBucket(Math.min(scale * dpr, cap))
}

/** Quantises a render scale (rounding down to 0.001) for cache keys and rendering. */
export function scaleBucket(rs: number): number {
  return Math.floor(rs * 1000 + 1e-9) / 1000
}

const LINE_PX = 16, PAGE_PX = 800

/** Below this pixel delta a wheel event is fine-grained (see `isFineWheelDelta`). */
const FINE_MAX_DELTA = 50

/**
 * Whether a wheel event comes from a touchpad (pinch or two-finger scroll) rather
 * than a mouse wheel: Chromium sends touchpad gestures as many small pixel
 * deltas, while a mouse wheel notch is ~100 or more. Smooth-scrolling mice
 * (free-spin wheels) send small deltas too and count as touchpad.
 */
export function isFineWheelDelta(deltaY: number, deltaMode: number): boolean {
  return deltaMode === 0 && Math.abs(deltaY) < FINE_MAX_DELTA
}

/** Zoom factor for one Ctrl + mouse wheel / pinch event. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  // Pinch deltas total 100·ln(1/scale), so exp(-Δ/100) makes the page follow the fingers 1:1.
  if (isFineWheelDelta(deltaY, deltaMode)) return Math.exp(-deltaY / 100)
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY
  return Math.exp(-px * 0.002)
}

/** 1-based page number from the page input, or null if invalid. */
export function parsePageInput(text: string, numPages: number): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= numPages ? n : null
}

/** Scale from a zoom percentage ("150", "150%", "12,5"), clamped; null if invalid. */
export function parseZoomInput(text: string): number | null {
  const t = text.trim().replace(/\s*%$/, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const pct = Number(t)
  return pct > 0 ? clampScale(pct / 100) : null
}
