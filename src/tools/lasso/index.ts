import type { PageViewport } from 'pdfjs-dist'
import { annotationKinds } from '../../core/registry/annotationKinds'
import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import { hitAnnotations } from '../../core/geometry/hit'
import { updateAnnotations } from '../../core/session/commands'
import { isEditable, type Annotation, type Point } from '../../core/session/model'
import { inRect, toPdfRect, toScreenRect } from '../select/handles'
import { clampShift } from '../select/crossPage'
import Icon from './Icon.svelte'
import { groupBounds, lassoed } from './geometry'

/** Screen pixels around an annotation that still count as clicking it. */
const HIT_TOLERANCE_PX = 4
/** Screen pixels the pointer must travel before a press on the selection becomes a move. */
const DRAG_THRESHOLD_PX = 3
/** Screen pixels between two recorded lasso points (fewer points, same outline). */
const LASSO_STEP_PX = 2

interface Lasso {
  kind: 'lasso'
  page: number
  points: Point[]
  /** The last recorded point on screen (page px). */
  last: Point
  /** Shift held: the catch is added to the selection instead of replacing it. */
  additive: boolean
}

interface Move {
  kind: 'move'
  page: number
  vp: PageViewport
  startPdf: Point
  startScreen: Point
  /** The annotations moved together, as they were at the press. */
  targets: Annotation[]
  moved: boolean
  result: Annotation[] | null
}

type Gesture = Lasso | Move

const now = () => new Date().toISOString()

function screenOf(e: PagePointerEvent): Point {
  const [x, y] = e.vp.convertToViewportPoint(e.pdf[0], e.pdf[1])
  return [x, y]
}

/**
 * Lasso selection. Dragging on empty space draws a freehand lasso; on release
 * the annotations mostly inside it on that page become the selection (with
 * Shift: are added to it). A click on an annotation selects it (Shift+click
 * adds or removes it). Dragging any selected annotation, or inside the
 * selection's box, moves the whole selection together on its page, committed
 * as one undo step on release. The selection always lies on a single page;
 * the overlay shows the selection actions (duplicate, flatten, delete) next
 * to it, and a right-click on an annotation selects it (or keeps the group
 * it belongs to) for the context menu. Flattened annotations are page
 * content to be: never selected.
 */
export function createLassoHandler(ctx: ToolContext): ToolHandler {
  let gesture: Gesture | null = null

  const editableOn = (page: number) => ctx.session.store.byPage(page).filter(isEditable)

  /** The selected annotations that are on `page`, in z-order. */
  function selectedOn(page: number): Annotation[] {
    const ids = new Set(ctx.selection.ids)
    return editableOn(page).filter((a) => ids.has(a.id))
  }

  function end(): void {
    gesture = null
    ctx.lasso?.set(null)
    ctx.pagePreviews?.set([])
    ctx.hidden.set([])
    ctx.cursor.set(null)
  }

  function startLasso(e: PagePointerEvent, additive: boolean): void {
    gesture = { kind: 'lasso', page: e.page, points: [e.pdf], last: screenOf(e), additive }
    ctx.lasso?.set({ page: e.page, points: [e.pdf] })
  }

  function startMove(e: PagePointerEvent, targets: Annotation[]): void {
    gesture = {
      kind: 'move',
      page: e.page,
      vp: e.vp,
      startPdf: e.pdf,
      startScreen: screenOf(e),
      targets,
      moved: false,
      result: null,
    }
  }

  /** The targets shifted with the pointer, the group kept on the page (as far as it was on it). */
  function moved(g: Move, e: PagePointerEvent): Annotation[] {
    const b = groupBounds(g.targets)
    if (!b) return g.targets
    const page = toPdfRect([0, 0, g.vp.width, g.vp.height], g.vp)
    const dx = clampShift(e.pdf[0] - g.startPdf[0], page[0] - b[0], page[2] - b[2])
    const dy = clampShift(e.pdf[1] - g.startPdf[1], page[1] - b[1], page[3] - b[3])
    const modifiedAt = now()
    return g.targets.map((a) => ({ ...annotationKinds.get(a.kind).translate(a, dx, dy), modifiedAt }))
  }

  function finishLasso(g: Lasso): void {
    const caught = lassoed(editableOn(g.page), g.points).map((a) => a.id)
    if (!g.additive) {
      ctx.selection.set(caught)
      return
    }
    const kept = selectedOn(g.page).map((a) => a.id)
    ctx.selection.set([...kept, ...caught.filter((id) => !kept.includes(id))])
  }

  function finishMove(g: Move): void {
    if (!g.moved || !g.result) return
    const changes = g.result.flatMap((after) => {
      const before = ctx.session.store.get(after.id)
      return before ? [{ before, after }] : []
    })
    if (changes.length > 0) ctx.execute(updateAnnotations('Move annotations', changes))
  }

  return {
    groupSelection: true,

    onPointerDown(e) {
      if (gesture) end()
      const shift = e.native.shiftKey
      const sel = selectedOn(e.page)
      const hit = hitAnnotations(editableOn(e.page), e.pdf, HIT_TOLERANCE_PX / e.vp.scale)[0]
      if (shift) {
        if (hit) {
          // Toggle it; a selection on another page is replaced.
          const ids = sel.map((a) => a.id)
          ctx.selection.set(ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id])
        } else {
          startLasso(e, true)
        }
        return
      }
      if (hit && sel.some((a) => a.id === hit.id)) return startMove(e, sel)
      if (hit) {
        ctx.selection.set([hit.id])
        return startMove(e, [hit])
      }
      const box = groupBounds(sel)
      if (box && inRect(toScreenRect(box, e.vp), screenOf(e))) return startMove(e, sel)
      ctx.selection.set([])
      startLasso(e, false)
    },

    onPointerMove(e) {
      const g = gesture
      if (!g || e.page !== g.page) return
      const p = screenOf(e)
      if (g.kind === 'lasso') {
        if (Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < LASSO_STEP_PX) return
        g.points.push(e.pdf)
        g.last = p
        ctx.lasso?.set({ page: g.page, points: g.points.slice() })
        return
      }
      if (!g.moved) {
        if (Math.hypot(p[0] - g.startScreen[0], p[1] - g.startScreen[1]) <= DRAG_THRESHOLD_PX) return
        g.moved = true
        ctx.hidden.set(g.targets.map((a) => a.id))
        ctx.cursor.set('move')
      }
      g.result = moved(g, e)
      ctx.pagePreviews?.set(g.result)
    },

    onPointerUp() {
      const g = gesture
      if (!g) return
      end()
      if (g.kind === 'lasso') finishLasso(g)
      else finishMove(g)
    },

    onContextMenu(e) {
      if (gesture) return false
      const hit = hitAnnotations(editableOn(e.page), e.pdf, HIT_TOLERANCE_PX / e.vp.scale)[0]
      if (!hit) return false
      // On the selection: the menu acts on the whole group; elsewhere on just this one.
      if (!selectedOn(e.page).some((a) => a.id === hit.id)) ctx.selection.set([hit.id])
      return true
    },

    onPointerCancel() {
      if (gesture) end()
    },

    onDeactivate() {
      if (gesture) end()
      ctx.selection.set([])
    },
  }
}

export const lassoTool: ToolDefinition<Record<string, never>> = {
  type: 'lasso',
  displayName: 'Lasso',
  description: 'Lasso annotations to move, duplicate, flatten or delete them together',
  shortcut: 'L',
  Icon,
  defaultSettings: {},
  Options: null,
  cursor: () => 'crosshair',
  allowMultipleInstances: false,
  createHandler: (ctx) => createLassoHandler(ctx),
}
