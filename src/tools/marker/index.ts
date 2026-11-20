import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import Icon from './Icon.svelte'
import Options from './Options.svelte'
import { createFreehandHandler, straightLine } from './freehand'
import { MARKER_PRESETS, type MarkerSettings } from './settings'
import { listenForTextSelection, noteFreehandFallback } from './textMode'
import { listenForUnmark } from '../shared/unmark'

export { MARKER_PRESETS, straightLine, type MarkerSettings }

/**
 * Picks a sub-handler per gesture from the current mode. In text mode the
 * native selection on the text layer is committed as highlights on pointerup
 * (see textMode.ts); the overlay only forwards pointer input in text mode on
 * pages without text, where the gesture falls back to freehand.
 */
export function createMarkerHandler(ctx: ToolContext, settings: () => MarkerSettings): ToolHandler {
  const freehand = createFreehandHandler(ctx, settings)
  const stopTextSelection = listenForTextSelection(ctx, settings)
  // Text mode: a right-button drag unmarks highlights (freehand mode erases instead).
  const stopUnmark = listenForUnmark(ctx, () => (settings().mode === 'text' ? 'highlight' : null))
  let active: ToolHandler | null = null

  function pick(): ToolHandler {
    if (settings().mode === 'text') noteFreehandFallback()
    return freehand
  }

  return {
    textSelection() {
      const s = settings()
      return s.mode === 'text' ? { color: s.color } : null
    },
    onPointerDown(e: PagePointerEvent) {
      active?.onPointerCancel?.(e)
      active = pick()
      active.onPointerDown?.(e)
    },
    onPointerMove(e: PagePointerEvent) {
      active?.onPointerMove?.(e)
    },
    onPointerUp(e: PagePointerEvent) {
      const h = active
      active = null
      h?.onPointerUp?.(e)
    },
    onPointerCancel(e: PagePointerEvent) {
      const h = active
      active = null
      h?.onPointerCancel?.(e)
    },
    onDeactivate() {
      stopTextSelection()
      stopUnmark()
      const h = active
      active = null
      h?.onDeactivate?.()
    },
  }
}

export const markerTool: ToolDefinition<MarkerSettings> = {
  type: 'marker',
  displayName: 'Marker',
  description: 'Highlight text or draw with a marker',
  shortcut: 'M',
  Icon,
  // Fully opaque: it draws multiply-blended, so the text underneath stays readable.
  defaultSettings: { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12 },
  Options,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: true,
  createHandler: createMarkerHandler,
}
