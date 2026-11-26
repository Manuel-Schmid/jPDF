import type { PageViewport } from 'pdfjs-dist'
import type { FreeTextAnnotation } from '../../core/session/model'
import { ASCENT, LINE_HEIGHT, lineX, TEXT_PADDING } from '../../core/geometry/textLayout'
import { EDITOR_BASELINE_SHIFT, fontStyle, fontWeight, screenBox } from './screen'

/**
 * Where a text box's lines are on screen, for the selectable copy of its text
 * that the text markup tools mark (see FreeTextLayer): HTML text over the
 * SVG render, glyph for glyph (same font, size and baselines).
 */

/** One line of a box: its text and where its line box starts (viewport px). */
export interface SelectableLine {
  text: string
  left: number
  /** Top of the line box (CSS line-height LINE_HEIGHT), so its baseline sits where Render draws it. */
  top: number
}

export interface SelectableBox {
  id: string
  /** The box on screen (viewport px): a press anywhere in it marks its text. */
  left: number
  top: number
  width: number
  height: number
  /** Font size (viewport px). */
  fontSize: number
  fontWeight: string
  fontStyle: string
  lines: SelectableLine[]
}

/**
 * Whether the box reads upright on its page. Turned boxes are not markable
 * (yet): their text would need turned quads.
 */
export const isUpright = (a: FreeTextAnnotation) => !a.rotation || a.rotation % 360 === 0

/**
 * The selectable lines of an upright box (blank lines left out), laid out as
 * Render.svelte draws them. With a CSS line height of LINE_HEIGHT, Arial puts
 * the baseline ASCENT + EDITOR_BASELINE_SHIFT em below the line box's top
 * (see EDITOR_BASELINE_SHIFT), so that is where each line box starts.
 */
export function selectableBox(a: FreeTextAnnotation, vp: PageViewport): SelectableBox {
  const box = screenBox(a.rect, vp)
  const s = vp.scale
  const size = a.fontSize * s
  const inner = box.width / s - 2 * TEXT_PADDING
  const firstBaseline = box.top + (TEXT_PADDING + a.fontSize * ASCENT) * s
  const lines: SelectableLine[] = []
  a.lines.forEach((text, i) => {
    if (text.trim() === '') return
    const baseline = firstBaseline + i * size * LINE_HEIGHT
    lines.push({
      text,
      left: box.left + (TEXT_PADDING + lineX(text, a.fontSize, inner, a.align, a.bold)) * s,
      top: baseline - (ASCENT + EDITOR_BASELINE_SHIFT) * size,
    })
  })
  return { id: a.id, ...box, fontSize: size, fontWeight: fontWeight(a), fontStyle: fontStyle(a), lines }
}
