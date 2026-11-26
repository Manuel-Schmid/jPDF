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
 * (see penButtonAction).
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
 * What a pen button does while held (Settings → Toolbar → Pen buttons):
 * - 'auto': as before there were settings. The side button acts like the
 *   right mouse button (see rightClickErases), except with a text-selecting
 *   tool, where it erases; the eraser end erases.
 * - 'eraser': erases with the pen eraser, whatever the tool.
 * - 'lasso': lassoes annotations, whatever the tool (ToolRouter.penLasso).
 * - 'none': the press does nothing at all.
 */
export const PEN_BUTTON_ACTIONS = ['auto', 'eraser', 'lasso', 'none'] as const
export type PenButtonAction = (typeof PEN_BUTTON_ACTIONS)[number]

/** The action of each pen button: the side (barrel) button and the eraser end (or second button). */
export interface PenButtonMap {
  side: PenButtonAction
  end: PenButtonAction
}

/** Today's behaviour: side button like the right mouse button, eraser end erases. */
export const DEFAULT_PEN_BUTTONS: PenButtonMap = { side: 'auto', end: 'eraser' }

/**
 * Which pen button a press is made with: 'end' for the pen's eraser end (or
 * a second button mapped to it: button 5 on pointerdown, buttons bit 32
 * while it stays down), 'side' for the side (barrel) button (button 2,
 * which drivers report like a right click). Null for every other press,
 * including all mouse and touch input.
 */
export function penButton(e: PenButtons): 'end' | 'side' | null {
  if (e.pointerType !== 'pen') return null
  if (e.button === 5 || (e.buttons & 32) !== 0) return 'end'
  return e.button === 2 ? 'side' : null
}

/**
 * What a pen press does by the pen-button map: 'erase' with the pen eraser
 * (ToolRouter.penEraser), 'lasso' with the pen lasso, or 'none' (swallowed).
 * Null when the press is not a mapped pen button, so it goes on as a mouse
 * press would: the tip, and the side button on 'auto' with a tool that is
 * not text-selecting (the right-button eraser or the page menu).
 */
export function penButtonAction(
  e: PenButtons,
  textSelecting: boolean,
  map: PenButtonMap = DEFAULT_PEN_BUTTONS,
): { button: 'end' | 'side'; action: 'erase' | 'lasso' | 'none' } | null {
  const button = penButton(e)
  if (!button) return null
  const mapped = map[button]
  if (mapped === 'lasso' || mapped === 'none') return { button, action: mapped }
  if (mapped === 'eraser' || button === 'end' || textSelecting) return { button, action: 'erase' }
  return null
}
