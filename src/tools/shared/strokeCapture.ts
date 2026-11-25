import type { Command } from '../../core/session/history.svelte'
import type { InkAnnotation, Point } from '../../core/session/model'
import { addAnnotations, compositeCommand } from '../../core/session/commands'
import { dedupe, simplify } from '../../core/geometry/stroke'
import { clipPolyline, type Box } from '../../core/geometry/clip'
import {
  dedupeIndices,
  pressureWidth,
  simplifyWithWidths,
  smoothPressure,
} from '../../core/geometry/pressure'
import type { PagePointerEvent, ToolContext, ToolHandler } from '../../core/registry/tools'
import { createPreviewFrame } from './previewFrame'
import { createPageHandoff, type PageHandoff } from './pageHandoff'

/** A recorded stroke after dedupe and simplification. */
interface Finished {
  pts: Point[]
  pressure: number[] | null
}

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

  /** Follows the stroke onto neighbouring pages (only where the viewer reports page frames). */
  let handoff: PageHandoff | null = null
  /** Whether page previews of the stroke's parts on other pages are shown. */
  let awayShown = false

  /** The ink of the parts on other pages, one annotation per page (none once straightened). */
  function awayInk(finish?: (raw: Point[], p: number[] | null) => Finished): InkAnnotation[] {
    if (!handoff || (shifted && straight)) return []
    const out: InkAnnotation[] = []
    for (const [pg, w] of handoff.away) {
      const done = w.strokes.map((s, i) => (finish ? finish(s, w.pressure?.[i] ?? null) : null))
      const strokes = done.map((d, i) => (d ? d.pts : w.strokes[i]))
      const pressure = w.pressure && done.map((d, i) => (d ? d.pressure! : w.pressure![i]))
      const a = { ...build(strokes[0], pg, pressure?.[0] ?? null), strokes }
      if (a.pressure && pressure) a.pressure = pressure
      out.push(a)
    }
    return out
  }

  const preview = createPreviewFrame(ctx, () => {
    if (!points) return null
    const away = awayInk()
    if (away.length > 0 || awayShown) ctx.pagePreviews?.set(away)
    awayShown = away.length > 0
    return build(current(), page, currentPressure())
  })

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
    handoff = null
    preview.clear()
    if (awayShown) ctx.pagePreviews?.set([])
    awayShown = false
  }

  const schedulePreview = preview.schedule

  /** The home page's top-left corner in client px at the time of `e`. */
  const originOf = (e: PagePointerEvent): Point => [
    e.native.clientX - e.screen[0],
    e.native.clientY - e.screen[1],
  ]

  /**
   * Dedupe and simplification of one recorded stroke (`scale` converts PDF
   * units to screen px). With pressure, over position and width, keeping the
   * pressure of each kept point.
   */
  function finish(raw: Point[], pressure: number[] | null, scale: number): Finished {
    if (!pressure || !setWidth)
      return { pts: simplify(dedupe(raw, 0.5 / scale), 0.35 / scale), pressure: null }
    const smooth = smoothPressure(pressure)
    const kept = dedupeIndices(raw, 0.5 / scale)
    const width = setWidth()
    const simple = simplifyWithWidths(
      kept.map((i) => raw[i]),
      kept.map((i) => pressureWidth(width, smooth[i])),
      0.35 / scale,
    )
    return { pts: simple.map((k) => raw[kept[k]]), pressure: simple.map((k) => smooth[kept[k]]) }
  }

  return {
    onPointerDown(e: PagePointerEvent) {
      reset()
      page = e.page
      points = [e.pdf]
      pressures = setWidth && e.native.pointerType === 'pen' ? [e.native.pressure] : null
      shifted = !!straight && !!e.native.shiftKey
      const pages = ctx.pages
      if (pages && e.vp.viewBox) {
        handoff = createPageHandoff(e.page, e.vp, (q) => pages.frame(q), pressures !== null)
        handoff.add([e.native.clientX, e.native.clientY], originOf(e), e.pdf, e.native.pressure)
      }
      restartHold(e.pdf, e.vp.scale)
      schedulePreview()
    },
    onPointerMove(e: PagePointerEvent) {
      if (!points) return
      if (straight && e.native.shiftKey) shifted = true
      const origin = originOf(e)
      const coalesced = e.native.getCoalescedEvents?.() ?? []
      if (coalesced.length > 0) {
        for (const c of coalesced) {
          const p = e.toPdf(c.clientX, c.clientY)
          points.push(p)
          pressures?.push(c.pressure)
          handoff?.add([c.clientX, c.clientY], origin, p, c.pressure)
        }
      } else {
        points.push(e.pdf)
        pressures?.push(e.native.pressure)
        handoff?.add([e.native.clientX, e.native.clientY], origin, e.pdf, e.native.pressure)
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
        const kept = pressures ? pressures[pressures.length - 1] : 0
        pressures?.push(kept)
        handoff?.add([e.native.clientX, e.native.clientY], originOf(e), e.pdf, kept)
      }
      const scale = e.vp.scale
      let pts: Point[]
      let pressure: number[] | null = null
      if (shifted && straight) {
        pts = current()
      } else {
        ;({ pts, pressure } = finish(raw, pressures, scale))
      }
      const pg = page
      // The parts drawn on other pages (a straightened stroke stays on its own).
      const h = handoff
      const away = awayInk((s, p) => finish(s, p, scale))
      reset()
      // Pointer capture keeps the points past the page edge; cut them off so
      // the stroke ends on the edge (the preview is hidden there anyway).
      const box = e.vp.viewBox as Box | undefined
      const own = box ? clipToPage(build(pts, pg, pressure), box) : build(pts, pg, pressure)
      const ink = [
        own,
        ...away.map((a) => clipToPage(a, h!.viewport(a.page)!.viewBox as Box)),
      ].filter((a): a is InkAnnotation => a !== null)
      if (ink.length === 0) return
      const parts = ink.map((a) => (commit ? commit(a) : addAnnotations([a])))
      // One undo step, however many pages the stroke crossed.
      ctx.execute(parts.length === 1 ? parts[0] : compositeCommand(parts[0].label, parts))
    },
    onPointerCancel() {
      reset()
    },
    onDeactivate() {
      reset()
    },
  }
}

/**
 * The ink clipped to the page box (`viewBox` of the page's viewport, PDF user
 * space): parts outside are dropped, a stroke that leaves and comes back
 * becomes several strokes of the same annotation. Null when nothing is left.
 */
export function clipToPage(a: InkAnnotation, box: Box): InkAnnotation | null {
  const strokes: Point[][] = []
  const pressure: number[][] = []
  a.strokes.forEach((s, i) => {
    const c = clipPolyline(s, a.pressure?.[i] ?? null, box)
    strokes.push(...c.strokes)
    if (c.pressure) pressure.push(...c.pressure)
  })
  if (strokes.length === 0) return null
  const out: InkAnnotation = { ...a, strokes }
  if (a.pressure) out.pressure = pressure
  return out
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
