import type { PageViewport } from 'pdfjs-dist'
import type { Rect, RGB } from '../../core/session/model'
import { boxHeight, LAST_LINE_TRIM, TEXT_PADDING } from '../../core/geometry/textLayout'

/** Screen box (viewport units) of a PDF rect: axis-aligned on screen for any page rotation. */
export function screenBox(rect: Rect, vp: PageViewport): { left: number; top: number; width: number; height: number } {
  const [ax, ay] = vp.convertToViewportPoint(rect[0], rect[1])
  const [bx, by] = vp.convertToViewportPoint(rect[2], rect[3])
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

export function cssColor(c: RGB): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
}

/** Font stack for boxes on screen: Arial has Helvetica's metrics (the saved font), Arial Bold Helvetica-Bold's. */
export const FREETEXT_FONT = 'Arial, Helvetica, sans-serif'
/** CSS `font-weight` / `font-style` of a box, as the saved face draws it. */
export const fontWeight = (a: { bold?: boolean }) => (a.bold ? 'bold' : 'normal')
export const fontStyle = (a: { italic?: boolean }) => (a.italic ? 'italic' : 'normal')

/**
 * How far the textarea's text must be lifted (em) to match the committed box:
 * Arial in a 1.2 line box puts the baseline (1.2 - (0.905 + 0.212)) / 2 + 0.905
 * = 0.9465 em below the line top; the saved appearance and the SVG render use
 * ASCENT = 0.8 em.
 */
export const EDITOR_BASELINE_SHIFT = 0.146

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Vertical insets (viewport units) of the editor textarea so its baselines sit
 * where the committed box draws them (top + TEXT_PADDING + ASCENT * fontSize)
 * and its bottom edge where the committed box ends (the box's last line is
 * shorter than a textarea line: LAST_LINE_TRIM comes off the bottom padding).
 * When the lift exceeds the top padding, the textarea starts `offsetTop` above
 * the box instead.
 */
export function editorInsets(
  fontSize: number,
  scale: number,
): { offsetTop: number; paddingTop: number; paddingBottom: number; minHeight: number } {
  const pad = TEXT_PADDING * scale
  const lift = EDITOR_BASELINE_SHIFT * fontSize * scale
  const offsetTop = Math.max(0, lift - pad)
  return {
    offsetTop: round3(offsetTop),
    paddingTop: round3(Math.max(0, pad - lift)),
    paddingBottom: round3(pad + lift - LAST_LINE_TRIM * fontSize * scale),
    minHeight: round3(boxHeight(1, fontSize) * scale + offsetTop),
  }
}

/**
 * SVG transform turning what is drawn in the screen box of `rect` by
 * `rotation` (degrees, counter-clockwise; see model Rotatable) around the
 * box's centre; undefined when not turned.
 */
export function turnTransform(rect: Rect, rotation: number | undefined, vp: PageViewport): string | undefined {
  if (!rotation) return undefined
  const b = screenBox(rect, vp)
  // SVG turns clockwise on screen for positive angles.
  return `rotate(${-rotation} ${b.left + b.width / 2} ${b.top + b.height / 2})`
}
