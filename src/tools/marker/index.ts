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

/** A SmartMark press in blank space that moves less than this (screen px) is a click: no dot. */
const CLICK_PX = 3

/**
 * Picks a sub-handler per gesture from the current mode. In text mode the
 * native selection on the text layer is committed as highlights on pointerup
 * (see textMode.ts). Without SmartMark the overlay lets all input through on
 * pages with text, and only pages without text reach the handler, which then
 * draws freehand (noted once with a hint). With SmartMark a press within
 * reach of text selects it (the overlay lets it through, see passThroughAt)
 * and a press anywhere else draws freehand.
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
  const smart = () => {
    const s = settings()
    return s.mode === 'text' && s.smartMark === true
  }
  /** SmartMark blank-space stroke: where it started (screen), until it moves past CLICK_PX. */
  let clickAt: [number, number] | null = null

  /** Null: the press is near text, where the text drag takes it (a press the overlay took anyway, e.g. touch). */
  function pick(e: PagePointerEvent): ToolHandler | null {
    if (settings().mode !== 'text') return freehand
    if (!smart()) {
      noteFreehandFallback()
      return freehand
    }
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
    /**
     * Only with SmartMark (read reactively by the overlay): without it the
     * overlay lets every press on a page with text through, as before.
     */
    get passThroughAt() {
      return smart() ? (e: PagePointerEvent) => reachAt(e) === 'near' : undefined
    },
    onPointerDown(e: PagePointerEvent) {
      active?.onPointerCancel?.(e)
      active = pick(e)
      clickAt = active && smart() ? e.screen : null
      active?.onPointerDown?.(e)
    },
    onPointerMove(e: PagePointerEvent) {
      if (clickAt && Math.hypot(e.screen[0] - clickAt[0], e.screen[1] - clickAt[1]) > CLICK_PX) clickAt = null
      active?.onPointerMove?.(e)
    },
    onPointerUp(e: PagePointerEvent) {
      const h = active
      const click = clickAt !== null
      active = null
      clickAt = null
      // A click in blank space (deselect habit, a missed double-click) leaves no dot.
      if (click) h?.onPointerCancel?.(e)
      else h?.onPointerUp?.(e)
    },
    onPointerCancel(e: PagePointerEvent) {
      const h = active
      active = null
      clickAt = null
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
  defaultSettings: { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12, holdStraight: true, smartMark: false },
  Options,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: true,
  createHandler: createMarkerHandler,
}
