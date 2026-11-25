import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import Icon from './Icon.svelte'
import Options from './Options.svelte'
import { createFreehandHandler, straightLine } from './freehand'
import { MARKER_PRESETS, type MarkerSettings } from './settings'
import { listenForTextSelection, noteFreehandFallback } from './textMode'
import { listenForUnmark } from '../shared/unmark'
import { textReach, type TextReach } from '../shared/textDrag'
import { textLayerFor } from '../../core/viewer/textLayers'

export { MARKER_PRESETS, straightLine, type MarkerSettings }

/**
 * Picks a sub-handler per gesture from the current mode. In text mode a
 * press within reach of text selects it (the overlay lets it through, see
 * passThroughAt) and the selection is committed as highlights on pointerup
 * (see textMode.ts); a press anywhere else draws freehand, and on a page
 * without text that is noted once with a hint.
 */
export function createMarkerHandler(ctx: ToolContext, settings: () => MarkerSettings): ToolHandler {
  const freehand = createFreehandHandler(ctx, settings)
  const stopTextSelection = listenForTextSelection(ctx, settings)
  /** Whether a press at `e` is within reach of text on its page ('none': no text layer there). */
  const reachAt = (e: PagePointerEvent): TextReach => {
    const t = e.native.target
    const hit = t instanceof Node ? textLayerFor(t) : null
    return hit ? textReach(hit[0], hit[1], e.native.clientX, e.native.clientY) : 'none'
  }
  // Text mode: a right-button drag unmarks highlights (freehand mode erases instead).
  const stopUnmark = listenForUnmark(ctx, () => (settings().mode === 'text' ? 'highlight' : null))
  let active: ToolHandler | null = null

  /** Null: the press is near text, where the text drag takes it (a press the overlay took anyway, e.g. touch). */
  function pick(e: PagePointerEvent): ToolHandler | null {
    if (settings().mode !== 'text') return freehand
    const reach = reachAt(e)
    if (reach === 'near') return null
    if (reach === 'none') noteFreehandFallback()
    return freehand
  }

  return {
    textSelection() {
      const s = settings()
      return s.mode === 'text' ? { color: s.color } : null
    },
    passThroughAt: (e) => settings().mode === 'text' && reachAt(e) === 'near',
    onPointerDown(e: PagePointerEvent) {
      active?.onPointerCancel?.(e)
      active = pick(e)
      active?.onPointerDown?.(e)
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
  defaultSettings: { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12, holdStraight: true },
  Options,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: true,
  createHandler: createMarkerHandler,
}
