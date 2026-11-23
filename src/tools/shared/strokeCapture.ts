import type { Command } from '../../core/session/history.svelte'
import type { InkAnnotation, Point } from '../../core/session/model'
import { addAnnotations } from '../../core/session/commands'
import { dedupe, simplify } from '../../core/geometry/stroke'
import {
  dedupeIndices,
  pressureWidth,
  simplifyWithWidths,
  smoothPressure,
} from '../../core/geometry/pressure'
import type { PagePointerEvent, ToolContext, ToolHandler } from '../../core/registry/tools'
import { createPreviewFrame } from './previewFrame'

/** How long the pointer must stay still before a stroke straightens (ms). */
export const HOLD_MS = 550
/** How far (screen px) the pointer may drift and still count as holding still. */
export const HOLD_TOLERANCE_PX = 4
/**
 * How far (screen px) the stroke must reach from its start before a hold
 * straightens it, so pressing and pausing before drawing stays freehand.
 */
export const HOLD_MIN_LENGTH_PX = 12

/** A straightened stroke: just the two end points. */
export function straightLine(start: Point, current: Point): Point[] {
  return [start, current]
}

export interface StrokeCaptureOptions {
  ctx: ToolContext
  /**
   * Builds the ink annotation for the given stroke; reads current settings.
   * `pressure` (one value per point) is set only with the `pressure` option
   * and a stroke drawn with a pen.
   */
  build(points: Point[], page: number, pressure: number[] | null): InkAnnotation
  /**
   * Record pen pressure (pen tool); returns the set stroke width (pt), so the
   * stroke is simplified without losing its width changes. Mouse and touch
   * strokes never carry pressure.
   */
  pressure?: () => number
  /**
   * When set, holding Shift at any point during the drag replaces the stroke
   * (committed and previewed) with `straight(start, current)`.
   */
  straight?(start: Point, current: Point): Point[]
  /**
   * With `straight`: whether holding the pointer still for `HOLD_MS` mid-stroke
   * straightens it like Shift does (read when the hold completes). Lets a pen
   * on a tablet draw straight lines without a keyboard.
   */
  holdToStraighten?(): boolean
  /** The command committing the finished stroke (default: add it). */
  commit?(a: InkAnnotation): Command
}

/** Pointer-driven freehand stroke capture shared by the pen and the marker. */
export function createStrokeCapture({
  ctx,
  build,
  straight,
  holdToStraighten,
  commit,
  pressure: setWidth,
}: StrokeCaptureOptions): ToolHandler {
  let points: Point[] | null = null
  /** Pressure per point while a pen stroke is recorded with pressure; null otherwise. */
  let pressures: number[] | null = null
  let page = 0
  let shifted = false
  /** Where the pointer last came to rest (PDF space); a hold is measured from here. */
  let anchor: Point = [0, 0]
  let holdTimer: ReturnType<typeof setTimeout> | null = null

  function current(): Point[] {
    const pts = points!
    return shifted && straight ? straight(pts[0], pts[pts.length - 1]) : pts.slice()
  }

  /** Pressure of the stroke as `current()` shapes it (none for a straightened one). */
  function currentPressure(): number[] | null {
    return pressures && !(shifted && straight) ? pressures.slice() : null
  }

  const preview = createPreviewFrame(ctx, () =>
    points ? build(current(), page, currentPressure()) : null,
  )

  function stopHold() {
    if (holdTimer !== null) clearTimeout(holdTimer)
    holdTimer = null
  }

  /**
   * Restarts the hold countdown from `p`, unless the stroke is already
   * straight or holding is not offered. `scale` converts PDF units to screen px.
   */
  function restartHold(p: Point, scale: number) {
    stopHold()
    if (shifted || !straight || !holdToStraighten) return
    anchor = p
    holdTimer = setTimeout(() => {
      holdTimer = null
      if (!points || !holdToStraighten()) return
      if (dist(points[0], anchor) * scale < HOLD_MIN_LENGTH_PX) return
      shifted = true
      schedulePreview()
    }, HOLD_MS)
  }

  /** With each new pointer position: moving off the resting point restarts the hold. */
  function trackHold(p: Point, scale: number) {
    if (holdTimer !== null && dist(p, anchor) * scale <= HOLD_TOLERANCE_PX) return
    restartHold(p, scale)
  }

  function reset() {
    stopHold()
    points = null
    pressures = null
    shifted = false
    preview.clear()
  }

  const schedulePreview = preview.schedule

  return {
    onPointerDown(e: PagePointerEvent) {
      reset()
      page = e.page
      points = [e.pdf]
      pressures = setWidth && e.native.pointerType === 'pen' ? [e.native.pressure] : null
      shifted = !!straight && !!e.native.shiftKey
      restartHold(e.pdf, e.vp.scale)
      schedulePreview()
    },
    onPointerMove(e: PagePointerEvent) {
      if (!points) return
      if (straight && e.native.shiftKey) shifted = true
      const coalesced = e.native.getCoalescedEvents?.() ?? []
      if (coalesced.length > 0) {
        for (const c of coalesced) {
          points.push(e.toPdf(c.clientX, c.clientY))
          pressures?.push(c.pressure)
        }
      } else {
        points.push(e.pdf)
        pressures?.push(e.native.pressure)
      }
      if (shifted) stopHold()
      else trackHold(points[points.length - 1], e.vp.scale)
      schedulePreview()
    },
    onPointerUp(e: PagePointerEvent) {
      if (!points) return
      if (straight && e.native.shiftKey) shifted = true
      const raw = points
      // The up event can carry a position the last move did not.
      const last = raw[raw.length - 1]
      // Its pressure is 0 (the pen has lifted): it keeps the last move's.
      if ((raw.length > 1 || shifted) && (last[0] !== e.pdf[0] || last[1] !== e.pdf[1])) {
        raw.push(e.pdf)
        pressures?.push(pressures[pressures.length - 1])
      }
      const scale = e.vp.scale
      let pts: Point[]
      let pressure: number[] | null = null
      if (shifted && straight) {
        pts = current()
      } else if (pressures && setWidth) {
        // The same dedupe and simplification as without pressure, over
        // position and width, keeping the pressure of each kept point.
        const smooth = smoothPressure(pressures)
        const kept = dedupeIndices(raw, 0.5 / scale)
        const width = setWidth()
        const simple = simplifyWithWidths(
          kept.map((i) => raw[i]),
          kept.map((i) => pressureWidth(width, smooth[i])),
          0.35 / scale,
        )
        pts = simple.map((k) => raw[kept[k]])
        pressure = simple.map((k) => smooth[kept[k]])
      } else {
        pts = simplify(dedupe(raw, 0.5 / scale), 0.35 / scale)
      }
      const pg = page
      reset()
      const a = build(pts, pg, pressure)
      ctx.execute(commit ? commit(a) : addAnnotations([a]))
    },
    onPointerCancel() {
      reset()
    },
    onDeactivate() {
      reset()
    },
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
