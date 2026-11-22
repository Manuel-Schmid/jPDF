import type { InkAnnotation } from '../../core/session/model'
import { newId } from '../../core/session/model'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import type { ToolContext, ToolHandler } from '../../core/registry/tools'
import { createStrokeCapture, straightLine } from '../shared/strokeCapture'
import type { MarkerSettings } from './settings'
import { markerStrokeCommand } from './merging'

export { straightLine }

export function createFreehandHandler(ctx: ToolContext, settings: () => MarkerSettings): ToolHandler {
  return createStrokeCapture({
    ctx,
    straight: straightLine,
    holdToStraighten: () => settings().holdStraight !== false,
    // Overlapping marker strokes of one style become one layer (no double darkening).
    commit: (a) => markerStrokeCommand(ctx.session.store, a),
    build(pts, page): InkAnnotation {
      const s = settings()
      return {
        id: newId(),
        page,
        sourceRef: null,
        modifiedAt: new Date().toISOString(),
        author: appSettings.data.author,
        kind: 'ink',
        strokes: [pts],
        color: s.color,
        width: s.width,
        opacity: s.opacity,
        blend: 'multiply',
        role: 'marker',
      }
    },
  })
}
