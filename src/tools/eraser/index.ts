import { hitAnnotations } from '../../core/geometry/hit'
import type { Annotation, Point } from '../../core/session/model'
import { isEditable } from '../../core/session/model'
import { deleteAnnotations } from '../../core/session/commands'
import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import Icon from './Icon.svelte'

/** Eraser radius in screen pixels. */
export const ERASER_RADIUS_PX = 6

const erasable = (a: Annotation): boolean =>
  a.kind === 'ink' || a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout' || a.kind === 'shape' || a.kind === 'line'

/** What an eraser removes: everything erasable, or only freehand marker strokes (SmartMark text mode). */
export type EraserScope = 'all' | 'markerStrokes'

const markerStroke = (a: Annotation): boolean => a.kind === 'ink' && a.role === 'marker'

export function createEraserHandler(ctx: ToolContext, scope: EraserScope = 'all'): ToolHandler {
  const canErase = scope === 'markerStrokes' ? markerStroke : erasable
  let erased: Map<string, Annotation> | null = null
  let prev: Point | null = null
  /** erased.size at the last publish: most moves erase nothing new. */
  let published = 0

  function reset() {
    erased = null
    prev = null
    published = 0
    ctx.hidden.set([])
  }

  function eraseAt(p: Point, e: PagePointerEvent) {
    if (!erased) return
    const radius = ERASER_RADIUS_PX / e.vp.scale
    const candidates = ctx.session.store.byPage(e.page).filter((a) => isEditable(a) && !erased!.has(a.id))
    for (const a of hitAnnotations(candidates, p, radius, canErase)) erased.set(a.id, a)
  }

  /** Tests the segment prev→p at spacing no larger than the radius, so fast drags skip nothing. */
  function eraseTo(p: Point, e: PagePointerEvent) {
    const radius = ERASER_RADIUS_PX / e.vp.scale
    const from = prev ?? p
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - from[0], p[1] - from[1]) / radius))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      eraseAt([from[0] + (p[0] - from[0]) * t, from[1] + (p[1] - from[1]) * t], e)
    }
    prev = p
  }

  function publish() {
    if (!erased || erased.size === published) return
    published = erased.size
    ctx.hidden.set(erased.keys())
  }

  return {
    onPointerDown(e) {
      reset()
      erased = new Map()
      eraseAt(e.pdf, e)
      prev = e.pdf
      publish()
    },
    onPointerMove(e) {
      if (!erased) return
      const coalesced = e.native.getCoalescedEvents?.() ?? []
      if (coalesced.length > 0) {
        for (const c of coalesced) eraseTo(e.toPdf(c.clientX, c.clientY), e)
      } else {
        eraseTo(e.pdf, e)
      }
      publish()
    },
    onPointerUp(e) {
      if (!erased) return
      eraseTo(e.pdf, e)
      const list = [...erased.values()]
      reset()
      if (list.length > 0) ctx.execute(deleteAnnotations(list))
    },
    onPointerCancel: reset,
    onDeactivate: reset,
  }
}

export const eraserTool: ToolDefinition<Record<string, never>> = {
  type: 'eraser',
  displayName: 'Eraser',
  description: 'Erase strokes, text markup and shapes',
  shortcut: 'E',
  Icon,
  defaultSettings: {},
  Options: null,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: false,
  createHandler: (ctx) => createEraserHandler(ctx),
}
