import type { InkAnnotation, Point } from '../../core/session/model'
import { newId } from '../../core/session/model'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import type { PagePointerEvent, ToolContext, ToolHandler } from '../../core/registry/tools'
import { createStrokeCapture, straightLine } from '../shared/strokeCapture'
import type { MarkerSettings } from './settings'
import { markerStrokeCommand } from './merging'
import { MAX_SAMPLES, bandSamples, markStyle, pageCanvasAt, sampleDark, spread } from './background'

export { straightLine }

export function createFreehandHandler(ctx: ToolContext, settings: () => MarkerSettings): ToolHandler {
  /**
   * Whether the stroke is drawn on a dark background (normal blend, lower
   * opacity): read at pointerdown, so the live preview shows it at once, and
   * confirmed over the whole stroke at pointerup.
   */
  let dark = false
  /** The page canvas under the press, read again at pointerup. */
  let canvas: HTMLCanvasElement | null = null
  /** The stroke's client points, sampled (a few of them) at pointerup only. */
  let client: Point[] = []
  /** Half the stroke width in client px. */
  let radius = 0

  const capture = createStrokeCapture({
    ctx,
    straight: straightLine,
    holdToStraighten: () => settings().holdStraight !== false,
    // Overlapping marker strokes of one style become one layer (no double darkening).
    commit: (a) => markerStrokeCommand(ctx.session.store, a),
    build(pts, page): InkAnnotation {
      const s = settings()
      const look = markStyle(dark, s.opacity)
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
        opacity: look.opacity,
        blend: look.blend,
        role: 'marker',
      }
    },
  })

  const at = (e: PagePointerEvent): Point => [e.native.clientX, e.native.clientY]

  return {
    ...capture,
    onPointerDown(e) {
      const p = at(e)
      client = [p]
      canvas = pageCanvasAt(p[0], p[1])
      // The press and the band around it (half the stroke width each way).
      radius = (settings().width * (e.vp.scale ?? 1)) / 2
      const r = radius
      dark = sampleDark(canvas, [...bandSamples([p], r), [p[0] - r, p[1]], [p[0] + r, p[1]]]) === true
      capture.onPointerDown!(e)
    },
    onPointerMove(e) {
      if (client.length > 0) client.push(at(e))
      capture.onPointerMove!(e)
    },
    onPointerUp(e) {
      if (client.length > 0) {
        client.push(at(e))
        // Spread over the stroke first, then each kept point's band: the
        // whole length is sampled, not just its start.
        const confirmed = sampleDark(canvas, bandSamples(spread(client, Math.ceil(MAX_SAMPLES / 3)), radius))
        if (confirmed !== null) dark = confirmed
      }
      client = []
      canvas = null
      capture.onPointerUp!(e)
    },
    onPointerCancel(e) {
      client = []
      canvas = null
      capture.onPointerCancel!(e)
    },
  }
}
