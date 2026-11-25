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
