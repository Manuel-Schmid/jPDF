import type { InkAnnotation } from '../../core/session/model'
import { newId } from '../../core/session/model'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import type { ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import { createStrokeCapture } from '../shared/strokeCapture'
import Icon from './Icon.svelte'
import Options from './Options.svelte'
import { PEN_PRESETS, type PenSettings } from './settings'

export { PEN_PRESETS, type PenSettings }

export function createPenHandler(ctx: ToolContext, settings: () => PenSettings): ToolHandler {
  return createStrokeCapture({
    ctx,
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
        blend: 'normal',
        role: 'pen',
      }
    },
  })
}

export const penTool: ToolDefinition<PenSettings> = {
  type: 'pen',
  displayName: 'Pen',
  description: 'Draw freehand',
  shortcut: 'P',
  Icon,
  defaultSettings: { color: [0.898, 0.224, 0.208], width: 1.5, opacity: 1 },
  Options,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: true,
  createHandler: createPenHandler,
}
