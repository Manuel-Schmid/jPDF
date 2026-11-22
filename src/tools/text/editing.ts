import type { TextEdit, ToolContext } from '../../core/registry/tools'
import { addAnnotations, deleteAnnotations, updateAnnotation } from '../../core/session/commands'
import type { FreeTextAnnotation, Point, Rect } from '../../core/session/model'
import { reanchorShift } from '../../core/geometry/rotation'
import {
  boxHeight,
  frameOrigin,
  frameSize,
  layoutLines,
  measureHelvetica,
  pageBoxRect,
  TEXT_PADDING,
} from '../../core/geometry/textLayout'

/**
 * `base` with `text`, its lines wrapped to the box's on-screen width and the
 * height fitted to them; the box keeps its on-screen top-left corner and width.
 */
export function layoutFreeText(base: FreeTextAnnotation, text: string, rotation: number): FreeTextAnnotation {
  return resizeFreeText({ ...base, text }, frameOrigin(base.rect, rotation), frameSize(base.rect, rotation).width, rotation)
}

/**
 * `base` with its on-screen top-left corner at `origin` (PDF) and `width` wide
 * on screen: lines re-wrapped to the width, height fitted to the lines.
 * `rotation` is the page's /Rotate. A turned box (its own `rotation`) is laid
 * out in its unturned frame (`origin` is a point of that frame) and then
 * shifted so the turned box stays where it was: its top-left corner stays put
 * when only the height changes.
 */
export function resizeFreeText(
  base: FreeTextAnnotation,
  origin: Point,
  width: number,
  rotation: number,
): FreeTextAnnotation {
  const lines = layoutLines(base.text, base.fontSize, width)
  const rect = pageBoxRect(origin, width, boxHeight(lines.length, base.fontSize), rotation)
  const [dx, dy] = reanchorShift(base.rect, rect, base.rotation ?? 0)
  const placed: Rect = dx === 0 && dy === 0 ? rect : [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy]
  return { ...base, lines, rect: placed, modifiedAt: new Date().toISOString() }
}

/**
 * On-screen width (pt) a box needs to hold `text` without soft wraps (its
 * longest line plus padding), clamped to `min`..`max`; whole points, so the
 * text always fits the width it was measured for.
 */
export function fittedWidth(text: string, fontSize: number, min: number, max: number): number {
  const longest = Math.max(0, ...text.split(/\r\n?|\n/).map((line) => measureHelvetica(line, fontSize)))
  return Math.min(max, Math.max(min, Math.ceil(longest + 2 * TEXT_PADDING)))
}

/** How a box opens: placed by a drag first (`sizing`), growing with its text up to a width (`autoWidth`). */
export interface BeginOptions {
  /** Shown but not focused until endSizing, so its width can be dragged out first (see TextEdit.sizing). */
  sizing?: boolean
  /**
   * The box widens with its text, from `min` up to `max` (pt, on screen),
   * and wraps beyond; a drag (resize) fixes the width instead.
   */
  autoWidth?: { min: number; max: number }
}

export interface TextEditing {
  /**
   * Opens the editor for `draft` (a new box when isNew, else the stored one,
   * hidden while editing).
   */
  begin(draft: FreeTextAnnotation, isNew: boolean, rotation: number, options?: BeginOptions): void
  /**
   * While sizing: makes the open box `width` wide on screen, keeping its
   * top-left corner. The width is then fixed (no more autoWidth).
   */
  resize(width: number): void
  /** Ends sizing: the editor takes focus and typing starts. */
  endSizing(): void
  /** Closes the open editor, if any, committing it: a new box is added (discarded if blank), an edited one updated (deleted if blank). */
  commit(): void
  readonly isOpen: boolean
}

/** An open editor: the box, whether it is new, the text typed so far, whether it is still being placed and whether it grows with its text. */
interface Open {
  draft: FreeTextAnnotation
  isNew: boolean
  rotation: number
  text: string
  sizing: boolean
  autoWidth: { min: number; max: number } | null
}

/** The text box editing state shared by the Text and Select tools. */
export function createTextEditing(ctx: ToolContext): TextEditing {
  let open: Open | null = null

  /** Hands the editor the current state of `o` (a new object, so the editor sees the change). */
  function publish(o: Open): void {
    const edit: TextEdit = {
      draft: o.draft,
      rotation: o.rotation,
      sizing: o.sizing,
      setText: (t) => setText(o, t),
      // Idempotent: blur, Escape and unmount may all end the same edit.
      commit: () => {
        if (open === o) commit()
      },
      escape: () => {
        if (open !== o) return
        commit()
        ctx.exit?.()
      },
    }
    ctx.textEdit.set(edit)
  }

  function setText(o: Open, text: string): void {
    o.text = text
    if (!o.autoWidth || open !== o) return
    const { min, max } = o.autoWidth
    const width = fittedWidth(text, o.draft.fontSize, min, max)
    if (width === frameSize(o.draft.rect, o.rotation).width) return
    o.draft = resizeFreeText({ ...o.draft, text }, frameOrigin(o.draft.rect, o.rotation), width, o.rotation)
    publish(o)
  }

  function commit(): void {
    const o = open
    if (!o) return
    open = null
    ctx.textEdit.set(null)
    if (!o.isNew) ctx.hidden.set([])
    if (ctx.session.pendingEdit === commit) ctx.session.pendingEdit = null

    const blank = o.text.trim() === ''
    if (o.isNew) {
      if (!blank) ctx.execute(addAnnotations([layoutFreeText(o.draft, o.text, o.rotation)]))
      return
    }
    // The current version: it may have changed (e.g. saved) while editing.
    const current = ctx.session.store.get(o.draft.id)
    if (current?.kind !== 'freetext') return
    if (blank) ctx.execute(deleteAnnotations([current]))
    else if (o.text !== current.text) ctx.execute(updateAnnotation(current, layoutFreeText(current, o.text, o.rotation)))
  }

  function begin(draft: FreeTextAnnotation, isNew: boolean, rotation: number, options: BeginOptions = {}): void {
    commit()
    const o: Open = {
      draft,
      isNew,
      rotation,
      text: draft.text,
      sizing: options.sizing ?? false,
      autoWidth: options.autoWidth ?? null,
    }
    open = o
    if (!isNew) ctx.hidden.set([draft.id])
    publish(o)
    ctx.session.pendingEdit = commit
  }

  function resize(width: number): void {
    const o = open
    if (!o?.sizing) return
    o.autoWidth = null
    o.draft = resizeFreeText({ ...o.draft, text: o.text }, frameOrigin(o.draft.rect, o.rotation), width, o.rotation)
    publish(o)
  }

  function endSizing(): void {
    const o = open
    if (!o?.sizing) return
    o.sizing = false
    publish(o)
  }

  return {
    begin,
    resize,
    endSizing,
    commit,
    get isOpen() {
      return open !== null
    },
  }
}
