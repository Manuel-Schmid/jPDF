import type { EraserScope } from './eraser'

/**
 * What holding the right mouse button does for the active tool: with tools
 * that draw or erase (pen, text box, shape, freehand marker, eraser) a right
 * drag erases; with the others (select, lasso, text-selecting tools, no tool)
 * a right click opens the page menu instead. Text-selecting tools (marker
 * text mode, underline, strike-out) unmark text with a right drag over it
 * (tools/shared/unmark.ts). The marker's SmartMark text mode does both: a
 * right drag on text unmarks it, one in blank space erases marker strokes
 * only ('markerStrokes'), so it never deletes a highlight it crosses.
 * A pen's side button erases with every one of the text-selecting tools
 * (see penEraseKind).
 */
const ERASING_TOOLS = new Set(['pen', 'text', 'shape', 'eraser'])

export function rightClickErases(type: string | null | undefined, settings: unknown): boolean | EraserScope {
  if (!type) return false
  if (ERASING_TOOLS.has(type)) return true
  if (type === 'marker') {
    const s = settings as { mode?: string; smartMark?: boolean } | null | undefined
    if (s?.mode === 'freehand') return true
    return s?.mode === 'text' && s.smartMark === true ? 'markerStrokes' : false
  }
  return false
}

/** The pen-button state a press is judged by (a subset of PointerEvent). */
export type PenButtons = Pick<PointerEvent, 'pointerType' | 'button' | 'buttons'>

/**
 * Which pen press erases with the pen eraser (ToolRouter.penEraser), whatever
 * the temporary eraser does:
 * - 'end': the pen's eraser end (button 5 on pointerdown, buttons bit 32
 *   while it stays down), with every tool;
 * - 'side': the pen's side (barrel) button (button 2, which drivers report
 *   like a right click) with a text-selecting tool (marker text mode,
 *   underline, strike-out), where the right mouse button unmarks text
 *   instead: a pen erases there as it does with the freehand marker.
 * Null for every other press, including all mouse and touch input.
 */
export function penEraseKind(e: PenButtons, textSelecting: boolean): 'end' | 'side' | null {
  if (e.pointerType !== 'pen') return null
  if (e.button === 5 || (e.buttons & 32) !== 0) return 'end'
  return textSelecting && e.button === 2 ? 'side' : null
}
