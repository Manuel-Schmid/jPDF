import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import { annotationKinds } from '../../core/registry/annotationKinds'
import type { FreeTextAnnotation, Point } from '../../core/session/model'
import { isEditable, newId } from '../../core/session/model'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import {
  boxHeight,
  defaultBoxWidth,
  minBoxWidth,
  normalizeRotation,
  pageBoxRect,
  screenDx,
} from '../../core/geometry/textLayout'
import { createTextEditing, layoutFreeText } from './editing'
import Icon from './Icon.svelte'
import Options from './Options.svelte'
import type { TextSettings } from './settings'

export { layoutFreeText, type TextSettings }

/** Screen pixels around a box that still count as clicking it. */
const HIT_TOLERANCE_PX = 4
/** Widest a clicked box grows while typing, as a fraction of the page's on-screen width. */
const AUTO_WIDTH_PAGE_FRACTION = 0.25

/**
 * Width range (pt) of a box placed with a click at `e`: from the default up
 * to a quarter of the page width or the room left to the page's right edge,
 * whichever is smaller (never below the default).
 */
export function autoWidthRange(e: PagePointerEvent, fontSize: number): { min: number; max: number } {
  const min = defaultBoxWidth(fontSize)
  const page = e.vp.width / e.vp.scale
  const room = (e.vp.width - e.screen[0]) / e.vp.scale
  return { min, max: Math.max(min, Math.floor(Math.min(page * AUTO_WIDTH_PAGE_FRACTION, room))) }
}

/**
 * Click on a page: opens the editor for the topmost text box under the
 * pointer, or for a new box with its top-left corner at the click. A new box
 * appears on the press, with the placeholder and the default width (the
 * placeholder fits). It keeps that width until the pointer is dragged past its
 * right edge; from then on the right edge follows the pointer (wider and
 * narrower, down to one letter) until release, when typing starts. A box
 * placed with a click grows to the right as text is typed, up to a quarter of
 * the page width or the page's right edge, whichever comes first, and wraps
 * beyond; a dragged box keeps its width. A click while a box is open only closes it.
 * Closing commits: a new box is added (discarded if blank), an edited one
 * updated (deleted if blank).
 */
export function createTextHandler(ctx: ToolContext, settings: () => TextSettings): ToolHandler {
  const editing = createTextEditing(ctx)
  /**
   * `placing`: a new box was opened by this press and follows the drag;
   * `following`: the pointer has passed the default width once, so the box's
   * right edge now tracks it.
   */
  let press: { pdf: Point; closedEdit: boolean; placing: boolean; following: boolean } | null = null

  function boxAt(e: PagePointerEvent, p: Point): FreeTextAnnotation | null {
    const tolerance = HIT_TOLERANCE_PX / e.vp.scale
    const onPage = ctx.session.store.byPage(e.page).filter(isEditable)
    for (let i = onPage.length - 1; i >= 0; i--) {
      const a = onPage[i]
      if (a.kind === 'freetext' && annotationKinds.get('freetext').hitTest(a, p, tolerance)) return a
    }
    return null
  }

  function newBox(page: number, origin: Point, rotation: number): FreeTextAnnotation {
    const s = settings()
    return {
      id: newId(),
      page,
      sourceRef: null,
      modifiedAt: new Date().toISOString(),
      author: appSettings.data.author,
      kind: 'freetext',
      rect: pageBoxRect(origin, defaultBoxWidth(s.fontSize), boxHeight(1, s.fontSize), rotation),
      text: '',
      lines: [''],
      fontSize: s.fontSize,
      textColor: s.textColor,
      background: s.background,
      align: s.align ?? 'left',
    }
  }

  return {
    onPointerDown(e) {
      const closedEdit = editing.isOpen
      editing.commit()
      const placing = !closedEdit && !boxAt(e, e.pdf)
      // Shown right away but focused only on release (sizing), once the
      // press's own focus change (mousedown) is over.
      if (placing) {
        const rotation = normalizeRotation(e.vp.rotation)
        editing.begin(newBox(e.page, e.pdf, rotation), true, rotation, {
          sizing: true,
          autoWidth: autoWidthRange(e, settings().fontSize),
        })
      }
      press = { pdf: e.pdf, closedEdit, placing, following: false }
    },
    onPointerMove(e) {
      if (!press?.placing) return
      const dx = screenDx(press.pdf, e.pdf, normalizeRotation(e.vp.rotation))
      const fontSize = settings().fontSize
      const initial = defaultBoxWidth(fontSize)
      if (!press.following && dx <= initial) return
      press.following = true
      editing.resize(Math.max(minBoxWidth(fontSize), dx))
    },
    // Existing boxes open on release: the press's own focus change (mousedown) is over by then.
    onPointerUp(e) {
      const p = press
      press = null
      if (!p || p.closedEdit) return
      if (p.placing) {
        editing.endSizing()
        return
      }
      if (editing.isOpen) return
      const hit = boxAt(e, p.pdf)
      if (hit) editing.begin(hit, false, normalizeRotation(e.vp.rotation))
    },
    onPointerCancel() {
      // An aborted placement: the box is still blank, so committing discards it.
      if (press?.placing) editing.commit()
      press = null
    },
    onDeactivate() {
      press = null
      editing.commit()
    },
  }
}

export const textTool: ToolDefinition<TextSettings> = {
  type: 'text',
  displayName: 'Text',
  description: 'Add a text box',
  shortcut: 'T',
  Icon,
  defaultSettings: { textColor: [0, 0, 0], fontSize: 12, background: null, align: 'left' },
  Options,
  cursor: () => 'text',
  defaultLocked: false,
  allowMultipleInstances: true,
  createHandler: createTextHandler,
}
