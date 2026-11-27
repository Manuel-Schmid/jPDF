import { hitAnnotations } from '../../core/geometry/hit'
import { cutInk } from '../../core/geometry/cut'
import type { Annotation, InkAnnotation, Point } from '../../core/session/model'
import { isEditable } from '../../core/session/model'
import { compositeCommand, deleteAnnotations, updateAnnotations } from '../../core/session/commands'
import type { Command } from '../../core/session/history.svelte'
import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import type { ToolInstance } from '../../core/settings/settings.svelte'
import Icon from './Icon.svelte'
import Options from './Options.svelte'

/** Eraser radius in screen pixels. */
export const ERASER_RADIUS_PX = 6

const erasable = (a: Annotation): boolean =>
  a.kind === 'ink' || a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout' || a.kind === 'shape' || a.kind === 'line'

/** What an eraser removes: everything erasable, or only freehand marker strokes (SmartMark text mode). */
export type EraserScope = 'all' | 'markerStrokes'

/**
 * How the eraser treats pen and marker strokes: 'stroke' erases a touched
 * annotation whole, 'partial' cuts out only the part under the eraser (other
 * kinds are still erased whole).
 */
export type EraserMode = 'stroke' | 'partial'

export interface EraserSettings {
  /** Absent in older saved settings: 'stroke'. */
  mode: EraserMode
}

/** The mode set on the toolbar's eraser, which the right-button and pen erasers follow too. */
export function eraserModeOf(toolbar: readonly ToolInstance[]): EraserMode {
  const s = toolbar.find((i) => i.type === 'eraser')?.settings as Partial<EraserSettings> | null | undefined
  return s?.mode === 'partial' ? 'partial' : 'stroke'
}

const markerStroke = (a: Annotation): boolean => a.kind === 'ink' && a.role === 'marker'

export function createEraserHandler(ctx: ToolContext, scope: EraserScope = 'all', mode: () => EraserMode = () => 'stroke'): ToolHandler {
  const canErase = scope === 'markerStrokes' ? markerStroke : erasable
  let erased: Map<string, Annotation> | null = null
  /**
   * Partial mode: ink annotations cut so far, as they are now (possibly with
   * no strokes left), by id. Copies: the store is changed only on up.
   */
  let cut: Map<string, InkAnnotation> | null = null
  let prev: Point | null = null
  /** Something was erased or cut since the last publish: most moves change nothing. */
  let dirty = false

  function reset() {
    erased = null
    cut = null
    prev = null
    dirty = false
    ctx.hidden.set([])
    ctx.pagePreviews?.set([])
  }

  function eraseAt(p: Point, e: PagePointerEvent) {
    if (!erased) return
    const radius = ERASER_RADIUS_PX / e.vp.scale
    const page = ctx.session.store.byPage(e.page)
    if (cut) {
      for (const a of page) {
        if (a.kind !== 'ink' || !canErase(a) || !isEditable(a)) continue
        const now = cut.get(a.id) ?? a
        if (now.strokes.length === 0) continue
        // Specks shorter than the eraser are dropped with the cut.
        const next = cutInk(now, p, radius, radius)
        if (next) {
          cut.set(a.id, next)
          dirty = true
        }
      }
    }
    const candidates = page.filter((a) => isEditable(a) && !erased!.has(a.id) && !(cut && a.kind === 'ink'))
    for (const a of hitAnnotations(candidates, p, radius, canErase)) {
      erased.set(a.id, a)
      dirty = true
    }
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

  /** Hides what is erased and touched; cut strokes are drawn as previews (with their ids) in their place. */
  function publish() {
    if (!erased || !dirty) return
    dirty = false
    ctx.hidden.set(cut ? [...erased.keys(), ...cut.keys()] : erased.keys())
    if (cut) ctx.pagePreviews?.set([...cut.values()].filter((a) => a.strokes.length > 0))
  }

  /** The drag's one undo step: erased annotations deleted, cut ones replaced by what is left of them. */
  function command(): Command | null {
    const gone = [...erased!.values()]
    const changes: { before: Annotation; after: Annotation }[] = []
    const modifiedAt = new Date().toISOString()
    for (const after of cut?.values() ?? []) {
      const before = ctx.session.store.byPage(after.page).find((a) => a.id === after.id)
      if (!before) continue
      if (after.strokes.length === 0) gone.push(before)
      else changes.push({ before, after: { ...after, modifiedAt } })
    }
    if (changes.length === 0) return gone.length > 0 ? deleteAnnotations(gone) : null
    const parts = [updateAnnotations('Erase', changes)]
    if (gone.length > 0) parts.unshift(deleteAnnotations(gone))
    return compositeCommand('Erase', parts)
  }

  return {
    onPointerDown(e) {
      reset()
      erased = new Map()
      if (mode() === 'partial') cut = new Map()
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
      const c = command()
      reset()
      if (c) ctx.execute(c)
    },
    onPointerCancel: reset,
    onDeactivate: reset,
  }
}

export const eraserTool: ToolDefinition<EraserSettings> = {
  type: 'eraser',
  displayName: 'Eraser',
  description: 'Erase strokes, text markup and shapes',
  shortcut: 'E',
  Icon,
  defaultSettings: { mode: 'stroke' },
  Options,
  cursor: () => 'crosshair',
  defaultLocked: true,
  allowMultipleInstances: false,
  createHandler: (ctx, settings) => createEraserHandler(ctx, 'all', () => (settings().mode === 'partial' ? 'partial' : 'stroke')),
}
