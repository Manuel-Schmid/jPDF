/**
 * What holding the right mouse button does for the active tool: with tools
 * that draw or erase (pen, text box, shape, freehand marker, eraser) a right
 * drag erases; with the others (select, lasso, text-selecting tools, no tool)
 * a right click opens the page menu instead. Text-selecting tools (marker
 * text mode, underline, strike-out) unmark text with a right drag over it
 * (tools/shared/unmark.ts).
 */
const ERASING_TOOLS = new Set(['pen', 'text', 'shape', 'eraser'])

export function rightClickErases(type: string | null | undefined, settings: unknown): boolean {
  if (!type) return false
  if (ERASING_TOOLS.has(type)) return true
  if (type === 'marker') return (settings as { mode?: string } | null | undefined)?.mode === 'freehand'
  return false
}
