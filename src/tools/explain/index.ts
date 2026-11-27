import { startSelectionExplanation } from '../../ai/explainSelection'
import { generationRuns } from '../../ai/runs.svelte'
import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import type { Point, Rect } from '../../core/session/model'
import type { Preferences } from '../../core/settings/preferences'
import { settings } from '../../core/settings/settings.svelte'
import { toasts } from '../../ui/toasts.svelte'
import Icon from './Icon.svelte'

/** Smallest box (pt, each side) that is explained: a click or a slip does nothing. */
export const MIN_BOX_PT = 6

/** The box between two corners, as an outline the overlay draws (the lasso's dashed blue). */
function outline(a: Point, b: Point): Point[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]]]
}

/**
 * AI Explain: drag a box over any part of a page (annotated or not) and, on
 * release, AI explains what is inside it; the answer is appended to the
 * page's explanation (see explainSelection.ts). It never selects or changes
 * annotations: that is the lasso's job. `prefs` and `explain` are seams for
 * tests.
 */
export function createExplainHandler(
  ctx: ToolContext,
  prefs: () => Preferences = () => settings.data.preferences,
  explain: typeof startSelectionExplanation = startSelectionExplanation,
): ToolHandler {
  let drag: { page: number; start: Point; end: Point } | null = null

  function reset() {
    drag = null
    ctx.lasso?.set(null)
  }

  return {
    onPointerDown(e: PagePointerEvent) {
      drag = { page: e.page, start: e.pdf, end: e.pdf }
      ctx.lasso?.set({ page: e.page, points: outline(e.pdf, e.pdf) })
    },
    onPointerMove(e) {
      if (!drag || e.page !== drag.page) return
      drag.end = e.pdf
      ctx.lasso?.set({ page: drag.page, points: outline(drag.start, drag.end) })
    },
    onPointerUp(e) {
      if (!drag) return
      if (e.page === drag.page) drag.end = e.pdf
      const { page, start, end } = drag
      reset()
      const rect: Rect = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]
      if (rect[2] - rect[0] < MIN_BOX_PT || rect[3] - rect[1] < MIN_BOX_PT) return
      if (generationRuns.isActive(ctx.session.id)) {
        toasts.show('Wait until the current explanation is done')
        return
      }
      explain(ctx.session, prefs(), { page, rect })
    },
    onPointerCancel: reset,
    onDeactivate: reset,
  }
}

export const explainTool: ToolDefinition<Record<string, never>> = {
  type: 'explain',
  displayName: 'AI Explain',
  description: 'Explain part of a page with AI',
  shortcut: 'A',
  Icon,
  defaultSettings: {},
  Options: null,
  cursor: () => 'crosshair',
  allowMultipleInstances: false,
  requiresAi: true,
  createHandler: (ctx) => createExplainHandler(ctx),
}
