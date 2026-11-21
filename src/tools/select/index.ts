import type { PageViewport } from 'pdfjs-dist'
import type { PagePointerEvent, ToolContext, ToolDefinition, ToolHandler } from '../../core/registry/tools'
import { annotationKinds } from '../../core/registry/annotationKinds'
import { hitAnnotations } from '../../core/geometry/hit'
import { frameOrigin, minBoxWidth, normalizeRotation } from '../../core/geometry/textLayout'
import { updateAnnotation } from '../../core/session/commands'
import type { Annotation, Point, Rect } from '../../core/session/model'
import { isEditable } from '../../core/session/model'
import { createTextEditing, resizeFreeText } from '../text/editing'
import {
  HANDLE_CURSORS, HANDLE_PILL, HANDLE_TOLERANCE_PX, handleAt, handlesFor, inRect, keepAspect, resizeRect, toPdfRect, toScreenRect, type Handle,
} from './handles'
import Icon from './Icon.svelte'
import { clampShift, dragAcrossPages, type CrossPageDrag, type PageFrame } from './crossPage'
import { createTextLookup, type TextLookup } from '../../core/viewer/textBoxes'
import { createLinkLookup, type LinkLookup, type PageLink } from '../../core/viewer/links'
import { followLink } from '../../core/viewer/followLink'

/** Screen pixels around an annotation that still count as clicking it. */
const HIT_TOLERANCE_PX = 4
/** Screen pixels around text that still start a text selection (not a pan). */
const TEXT_TOLERANCE_PX = 5
export { HANDLE_TOLERANCE_PX }
/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 3
/** Max time between two clicks on a text box that opens its editor. */
const DOUBLE_CLICK_MS = 500
/** Smallest extent (pt, without the stroke width) ink, shapes and images can be resized to. */
const INK_MIN_SIZE = 4

interface Press {
  target: Annotation
  /** null = move; else the handle being dragged. */
  handle: Handle | null
  vp: PageViewport
  startPdf: Point
  startScreen: Point
  /** The target's bounds on screen at the press. */
  box: Rect
  moved: boolean
  result: Annotation | null
  /** A move that may carry the target to other pages (all kinds but text markup). */
  cross: CrossPageDrag | null
}

const now = () => new Date().toISOString()

/** Text markup belongs to the text under it: it moves on its page only. */
const onText = (a: Annotation) => a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout'

const clientOf = (e: PagePointerEvent): Point => [e.native.clientX, e.native.clientY]

function screenOf(e: PagePointerEvent): Point {
  const [x, y] = e.vp.convertToViewportPoint(e.pdf[0], e.pdf[1])
  return [x, y]
}

/** The page's rect in PDF space. */
function pageRect(vp: PageViewport): Rect {
  return toPdfRect([0, 0, vp.width, vp.height], vp)
}

/** PDF direction of "screen right" on a page with this /Rotate. */
function screenRight(rotation: number): Point {
  switch (normalizeRotation(rotation)) {
    case 90:
      return [0, 1]
    case 180:
      return [-1, 0]
    case 270:
      return [0, -1]
    default:
      return [1, 0]
  }
}

const inset = (r: Rect, d: number): Rect => [r[0] + d, r[1] + d, r[2] - d, r[3] - d]

/** Text on the session's shown pages (see createTextLookup); null where the session has no pages (stand-ins). */
function sessionText(ctx: ToolContext): TextLookup {
  const s = ctx.session
  return createTextLookup(
    () => s.pages,
    (source) => s.doc?.getPage(source + 1),
  )
}

/** Clickable links of a document: where they are and what a click on one does. */
export interface SelectLinks {
  at: LinkLookup
  /** Follows `link`, clicked on shown page `page` (0-based). */
  follow(link: PageLink, page: number): void
}

/** Links on the session's shown pages (see createLinkLookup), followed with followLink. */
function sessionLinks(ctx: ToolContext): SelectLinks {
  const s = ctx.session
  return {
    at: createLinkLookup(
      () => s.pages,
      (source) => s.doc?.getPage(source + 1),
    ),
    follow: (link, page) => {
      followLink(s, link, page).catch((e: unknown) => console.error('Failed to follow link', e))
    },
  }
}

/**
 * The default tool. A stationary click selects the topmost annotation under
 * the pointer; only the selected annotation moves when dragged, and its
 * handles resize it (text boxes in width, ink, shapes and images in any
 * direction; image corners keep the aspect ratio). A drag that starts on an
 * unselected annotation pans instead, like one on blank space, so panning
 * never moves something by accident. A move or resize is previewed live
 * and committed as one update on release. Over text pointer input passes
 * through to the text layer (native selection, Ctrl+C copies); a press on
 * blank space deselects and dragging there pans the view (this tool is also
 * the hand). A right-click on an annotation selects it for the context
 * menu. Double-clicking a text box opens its editor. `textAt` tells where
 * the pages have text (while unknown, input passes through as over text).
 * A link of the file shows the pointer cursor (a web link its address) and
 * is followed by a stationary click where no annotation is in the way; a
 * drag there pans as on blank space. Other tools never follow links, so
 * drawing over one still draws.
 */
export function createSelectHandler(
  ctx: ToolContext,
  textAt: TextLookup = sessionText(ctx),
  links: SelectLinks = sessionLinks(ctx),
): ToolHandler {
  const editing = createTextEditing(ctx)
  let press: Press | null = null
  /** A press on a link, not yet a click or a drag: released in place it follows the link, dragged it pans. */
  let linkPress: { link: PageLink; page: number; client: Point; screen: Point } | null = null
  let lastClick: { id: string; time: number } | null = null
  /** A pan in progress: the pointer's last client position. */
  let pan: Point | null = null
  /**
   * A press on an unselected annotation, not yet a click or a drag: released
   * in place it selects `target`, dragged it becomes a pan from `client`.
   */
  let pending: { target: Annotation; client: Point; screen: Point } | null = null

  /** Whether a press at `e` belongs to the text layer (over text, or not yet known). */
  const overText = (e: PagePointerEvent) => textAt(e.page, e.pdf, TEXT_TOLERANCE_PX / e.vp.scale) !== false

  /** The editable annotation under the pointer, topmost first. */
  const hitAt = (e: PagePointerEvent) =>
    hitAnnotations(ctx.session.store.byPage(e.page).filter(isEditable), e.pdf, HIT_TOLERANCE_PX / e.vp.scale)[0]

  function endPan(): void {
    pan = null
    ctx.cursor.set('grab')
  }

  function selectedOn(page: number): Annotation | null {
    const id = ctx.selection.ids[0]
    const a = id === undefined ? undefined : ctx.session.store.get(id)
    return a && a.page === page ? a : null
  }

  /** What a press at `e` grabs: a handle of the selection, an annotation, or nothing. */
  function targetAt(e: PagePointerEvent): { a: Annotation; handle: Handle | null } | null {
    const sel = selectedOn(e.page)
    const p = screenOf(e)
    const box = sel && toScreenRect(annotationKinds.get(sel.kind).bounds(sel), e.vp)
    if (sel && box) {
      const handle = handleAt(box, p, HANDLE_TOLERANCE_PX, handlesFor(sel), HANDLE_PILL)
      if (handle) return { a: sel, handle }
    }
    const hit = hitAt(e)
    if (hit) return { a: hit, handle: null }
    // Inside the selection box (e.g. between ink strokes) still drags the selection.
    if (sel && box && inRect(box, p)) return { a: sel, handle: null }
    return null
  }

  function end(): void {
    if (press?.cross) ctx.crossDrag?.set(null)
    press = null
    ctx.preview.set(null)
    ctx.hidden.set([])
    ctx.cursor.set(null)
  }

  function moved(pr: Press, e: PagePointerEvent): Annotation {
    const a = pr.target
    const kind = annotationKinds.get(a.kind)
    const b = kind.bounds(a)
    const page = pageRect(pr.vp)
    const dx = clampShift(e.pdf[0] - pr.startPdf[0], page[0] - b[0], page[2] - b[2])
    const dy = clampShift(e.pdf[1] - pr.startPdf[1], page[1] - b[1], page[3] - b[3])
    return { ...kind.translate(a, dx, dy), modifiedAt: now() }
  }

  /** The frame of `page`: the event's own page from the event, others from the mounted pages. */
  function frameOf(e: PagePointerEvent, page: number): PageFrame | null {
    if (page !== e.page) return ctx.pages?.frame(page) ?? null
    const [cx, cy] = clientOf(e)
    return { vp: e.vp, origin: [cx - e.screen[0], cy - e.screen[1]] }
  }

  function movedAcross(pr: Press & { cross: CrossPageDrag }, e: PagePointerEvent): Annotation {
    const r = dragAcrossPages(pr.cross, clientOf(e), (page) => frameOf(e, page))
    if (r.annotation.page !== pr.cross.base.page) ctx.crossDrag?.set({ page: e.page, at: r.annotation.page })
    pr.cross = r.drag
    return { ...r.annotation, modifiedAt: now() }
  }

  function resized(pr: Press, handle: Handle, e: PagePointerEvent): Annotation {
    const { vp, box, target: a } = pr
    const [sx, sy] = screenOf(e)
    // The dragged edge stays on the page.
    const dx = Math.min(Math.max(sx, 0), vp.width) - pr.startScreen[0]
    const dy = Math.min(Math.max(sy, 0), vp.height) - pr.startScreen[1]
    if (a.kind === 'freetext') {
      const rotation = normalizeRotation(vp.rotation)
      // As narrow as the text tool can place it: one letter.
      const r = resizeRect(box, handle, dx, 0, minBoxWidth(a.fontSize) * vp.scale)
      const shift = (r[0] - box[0]) / vp.scale
      const [ox, oy] = frameOrigin(a.rect, rotation)
      const [rx, ry] = screenRight(rotation)
      return resizeFreeText(a, [ox + rx * shift, oy + ry * shift], (r[2] - r[0]) / vp.scale, rotation)
    }
    const kind = annotationKinds.get(a.kind)
    if (!kind.scale) return a
    // Ink and shape bounds include half the stroke width, which does not
    // scale; line bounds also their arrowhead (margins beyond scaleFrame).
    const bounds = kind.bounds(a)
    const pad = a.kind === 'ink' ? a.width / 2 : a.kind === 'shape' && a.border ? a.border.width / 2 : 0
    const from = kind.scaleFrame?.(a) ?? inset(bounds, pad)
    const m = [from[0] - bounds[0], from[1] - bounds[1], bounds[2] - from[2], bounds[3] - from[3]]
    const min = (INK_MIN_SIZE + Math.max(m[0] + m[2], m[1] + m[3])) * vp.scale
    let r = resizeRect(box, handle, dx, dy, min)
    // Image corners keep the aspect ratio (edges stretch).
    if (a.kind === 'image') r = keepAspect(box, r, handle, [0, 0, vp.width, vp.height], min)
    const to = toPdfRect(r, vp)
    const target: Rect = [to[0] + m[0], to[1] + m[1], to[2] - m[2], to[3] - m[3]]
    return { ...kind.scale(a, from, target), modifiedAt: now() }
  }

  function isDoubleClick(a: Annotation, e: PagePointerEvent): boolean {
    const time = e.native.timeStamp
    const prev = lastClick
    lastClick = { id: a.id, time }
    if (!prev || prev.id !== a.id || time - prev.time > DOUBLE_CLICK_MS) return false
    lastClick = null
    return true
  }

  return {
    passThroughAt: (e) => targetAt(e) === null && overText(e) && !links.at(e.page, e.pdf, 0),

    onPassThroughDown(e) {
      editing.commit()
      // Without hover (touch) the press may still land on an annotation.
      const hit = hitAt(e)
      ctx.selection.set(hit ? [hit.id] : [])
    },

    onHover(e) {
      // Blank space pans: the hand. The selection can be moved: the move
      // cursor (a handle shows how it resizes). Other annotations: the arrow.
      const t = targetAt(e)
      const link = t ? null : (links.at(e.page, e.pdf, 0) ?? null)
      ctx.hint?.set(link?.target.kind === 'url' ? { page: e.page, text: link.target.url } : null)
      if (link) return ctx.cursor.set('pointer')
      if (!t) return ctx.cursor.set('grab')
      if (t.handle) return ctx.cursor.set(HANDLE_CURSORS[t.handle])
      ctx.cursor.set(ctx.selection.ids.includes(t.a.id) ? 'move' : null)
    },

    onContextMenu(e) {
      editing.commit()
      if (press || pan || pending) return false
      const hit = hitAt(e)
      if (!hit) return false
      ctx.selection.set([hit.id])
      return true
    },

    onPointerDown(e) {
      editing.commit()
      if (press) end()
      pending = null
      const t = targetAt(e)
      if (!t) {
        ctx.selection.set([])
        const link = links.at(e.page, e.pdf, 0)
        if (link) {
          linkPress = { link, page: e.page, client: [e.native.clientX, e.native.clientY], screen: screenOf(e) }
          return
        }
        pan = [e.native.clientX, e.native.clientY]
        ctx.cursor.set('grabbing')
        return
      }
      if (!t.handle && !ctx.selection.ids.includes(t.a.id)) {
        // Not selected yet: a click selects it, a drag pans (never moves it).
        pending = { target: t.a, client: [e.native.clientX, e.native.clientY], screen: screenOf(e) }
        return
      }
      ctx.selection.set([t.a.id])
      press = {
        target: t.a,
        handle: t.handle,
        vp: e.vp,
        startPdf: e.pdf,
        startScreen: screenOf(e),
        box: toScreenRect(annotationKinds.get(t.a.kind).bounds(t.a), e.vp),
        moved: false,
        result: null,
        cross: null,
      }
      if (t.handle) ctx.cursor.set(HANDLE_CURSORS[t.handle])
    },

    onPointerMove(e) {
      if (linkPress) {
        const [x, y] = screenOf(e)
        if (Math.hypot(x - linkPress.screen[0], y - linkPress.screen[1]) <= DRAG_THRESHOLD_PX) return
        // A drag: pan from the press, as on blank space.
        pan = linkPress.client
        linkPress = null
        ctx.hint?.set(null)
        ctx.cursor.set('grabbing')
      }
      if (pending) {
        const [x, y] = screenOf(e)
        if (Math.hypot(x - pending.screen[0], y - pending.screen[1]) <= DRAG_THRESHOLD_PX) return
        // A drag: pan from the press, so the threshold travel is not lost.
        pan = pending.client
        pending = null
        lastClick = null
        ctx.cursor.set('grabbing')
      }
      if (pan) {
        // Client deltas: page-local coordinates move with the page while panning.
        const { clientX: x, clientY: y } = e.native
        ctx.session.scrollBy(-(x - pan[0]), -(y - pan[1]))
        pan = [x, y]
        return
      }
      const pr = press
      if (!pr) return
      if (!pr.moved) {
        const [x, y] = screenOf(e)
        if (Math.hypot(x - pr.startScreen[0], y - pr.startScreen[1]) <= DRAG_THRESHOLD_PX) return
        pr.moved = true
        ctx.hidden.set([pr.target.id])
        if (!pr.handle) ctx.cursor.set('move')
        if (!pr.handle && !onText(pr.target)) {
          // Anchored at the press, so the threshold travel is not lost.
          pr.cross = { base: pr.target, anchor: pr.startScreen }
          ctx.crossDrag?.set({ page: e.page })
        }
      }
      pr.result = pr.handle ? resized(pr, pr.handle, e) : pr.cross ? movedAcross(pr as Press & { cross: CrossPageDrag }, e) : moved(pr, e)
      ctx.preview.set(pr.result)
    },

    onPointerUp(e) {
      if (linkPress) {
        const { link, page } = linkPress
        linkPress = null
        ctx.hint?.set(null)
        links.follow(link, page)
        return
      }
      if (pan) return endPan()
      if (pending) {
        // A stationary click: select it (the first click of a text box's double click).
        const { target } = pending
        pending = null
        ctx.selection.set([target.id])
        ctx.cursor.set('move')
        isDoubleClick(target, e)
        return
      }
      const pr = press
      if (!pr) return
      end()
      if (pr.moved) {
        lastClick = null
        if (!pr.result) return
        const before = ctx.session.store.get(pr.target.id)
        if (before) ctx.execute(updateAnnotation(before, pr.result))
        return
      }
      const current = ctx.session.store.get(pr.target.id)
      if (current?.kind === 'freetext' && isDoubleClick(current, e)) {
        editing.begin(current, false, normalizeRotation(e.vp.rotation))
      }
    },

    onPointerCancel() {
      linkPress = null
      pending = null
      if (pan) endPan()
      if (press) end()
    },

    onDeactivate() {
      editing.commit()
      pan = null
      linkPress = null
      pending = null
      ctx.hint?.set(null)
      if (press) end()
      lastClick = null
      ctx.selection.set([])
    },
  }
}

export const selectTool: ToolDefinition<Record<string, never>> = {
  type: 'select',
  displayName: 'Select',
  description: 'Select, move and edit annotations; select text; drag blank space to pan',
  shortcut: 'V',
  Icon,
  defaultSettings: {},
  Options: null,
  cursor: () => 'default',
  allowMultipleInstances: false,
  createHandler: (ctx) => createSelectHandler(ctx),
}
