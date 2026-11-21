import type { PageViewport } from 'pdfjs-dist'
import type { Component } from 'svelte'
import type { Command } from '../session/history.svelte'
import type { Annotation, FreeTextAnnotation, Point, RGB } from '../session/model'
import type { DocumentSession } from '../session/session.svelte'

/** A mounted page: its viewport and its top-left corner in client px. */
export interface PageFrame {
  vp: PageViewport
  origin: Point
}

export interface PagePointerEvent {
  /** 0-based, matches Annotation.page */
  page: number
  pdf: Point
  screen: Point
  vp: PageViewport
  native: PointerEvent
  /** Maps client coordinates (e.g. of coalesced events) to PDF user space, as `pdf` was. */
  toPdf(clientX: number, clientY: number): Point
}

export interface ToolHandler {
  onPointerDown?(e: PagePointerEvent): void
  onPointerMove?(e: PagePointerEvent): void
  onPointerUp?(e: PagePointerEvent): void
  /** The gesture was aborted (pointercancel, lost capture, page unmounted): discard it, do not commit. */
  onPointerCancel?(e: PagePointerEvent): void
  /**
   * A pointer moved over a page while no gesture is in progress and no button
   * is pressed (e.g. the polyline's next segment follows the pointer).
   */
  onHover?(e: PagePointerEvent): void
  /** A key pressed outside editable fields while the tool is active; true = consumed (no shortcut runs). */
  onKeyDown?(e: KeyboardEvent): boolean
  onDeactivate?(): void
  /**
   * Non-null while the tool selects text natively (marker text mode,
   * underline, strike-out): on pages that have text, the overlay lets pointer
   * input through to the text layer, whose selection is tinted with `color`
   * (null: not drawn at all, the tool previews its result instead); the
   * handler then receives pointer input only on pages without text. Read
   * reactively by the viewer.
   */
  textSelection?(): { color: RGB | null } | null
  /**
   * Hover-based text pass-through (select tool): whether pointer input at `e`
   * should go through to the text layer because nothing of the tool's is
   * there. Evaluated as the pointer hovers a page that has (or may have) text,
   * while no button is pressed; a press where it returned true goes to the
   * text layer (native text selection) and is reported via onPassThroughDown
   * instead of onPointerDown.
   */
  passThroughAt?(e: PagePointerEvent): boolean
  /** A press that passThroughAt let through to the text layer (e.g. deselect). */
  onPassThroughDown?(e: PagePointerEvent): void
  /**
   * A right-click that opens the page menu (tools without the temporary
   * eraser), before the menu opens: the tool may select what is under the
   * pointer. True = the click is on the selection, so the menu offers its
   * actions (duplicate, flatten, delete).
   */
  onContextMenu?(e: PagePointerEvent): boolean
  /**
   * The selection may hold several annotations (lasso): the overlay outlines
   * each one and their common box, without resize handles, and shows the
   * selection actions (duplicate, flatten, delete) next to it.
   */
  groupSelection?: boolean
}

/** A lasso being drawn on `page`: its outline so far, in PDF user space. */
export interface LassoPath {
  page: number
  points: readonly Point[]
}

/**
 * An open text box editor (Overlay draws it as a <textarea> on `draft.page`).
 * The editor reports every change through setText and ends editing with
 * commit (Escape, blur, unmount); commit is idempotent.
 */
export interface TextEdit {
  /** The box being edited: position, size and style; `text` is the initial text. */
  draft: FreeTextAnnotation
  /** /Rotate of the box's page (the editor is laid out upright on screen). */
  rotation: number
  /**
   * The box is still being placed (its width dragged out): the editor shows
   * it with the placeholder but takes no focus or pointer input yet.
   */
  sizing?: boolean
  setText(text: string): void
  commit(): void
  /** Escape in the editor: commits, then hands over to the select tool (see ToolContext.exit). */
  escape?(): void
}

export interface ToolContext {
  session: DocumentSession
  /**
   * Runs `c` as one undo step. Each call counts as one use of the tool: an
   * unlocked tool then hands over to the select tool (see
   * ToolDefinition.defaultLocked).
   */
  execute(c: Command): void
  /** Hands over to the select tool (e.g. Escape in the text editor); a no-op once the tool is no longer active. */
  exit?(): void
  selection: { ids: string[]; set(ids: string[]): void }
  /** Live, uncommitted annotation drawn by Overlay. */
  preview: { set(a: Annotation | null): void }
  /**
   * Live, uncommitted annotations, any number per page (e.g. text markup of a
   * selection across pages, a group being moved), drawn on pages where
   * `preview` has nothing.
   */
  pagePreviews?: { set(list: readonly Annotation[]): void }
  /** The lasso outline drawn by Overlay (null: none); cleared when the tool changes. */
  lasso?: { set(l: LassoPath | null): void }
  /** Annotations hidden by Overlay while a gesture (e.g. erasing) is in progress; cleared when the tool changes. */
  hidden: { readonly ids: ReadonlySet<string>; set(ids: Iterable<string>): void }
  /** Overrides the tool's cursor (e.g. 'grabbing' during a drag); null restores it. */
  cursor: { set(c: string | null): void }
  /** Opens (or with null closes) the text box editor; cleared when the tool changes. */
  textEdit: { set(e: TextEdit | null): void }
  /** Frames of the pages currently mounted (0-based); null for others. */
  pages?: { frame(page: number): PageFrame | null }
  /**
   * A drag that may carry an element across pages, started on `page`, the
   * element now on `at`: the viewer keeps both pages mounted and auto-scrolls
   * near its edges; null ends it.
   */
  crossDrag?: { set(d: { page: number; at?: number } | null): void }
  /**
   * A tooltip on `page` (0-based) while the pointer is over something with
   * one (a link's address); null hides it. Cleared when the tool changes.
   */
  hint?: { set(h: { page: number; text: string } | null): void }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<S = any> {
  type: string
  displayName: string
  description: string
  shortcut?: string // single letter
  Icon: Component<{ settings: S; size: number }>
  defaultSettings: S
  Options: Component<{ settings: S; update(patch: Partial<S>): void }> | null
  cursor?(settings: S): string
  /**
   * Whether a new instance is locked: a locked tool stays active after each
   * use, an unlocked one hands over to the select tool. The user toggles it
   * per instance (ToolInstance.locked). Undefined: the tool has no lock and
   * always stays active (select, lasso).
   */
  defaultLocked?: boolean
  allowMultipleInstances: boolean
  createHandler(ctx: ToolContext, settings: () => S): ToolHandler
}

export interface ToolRegistry {
  register(d: ToolDefinition): void
  get(type: string): ToolDefinition
  list(): ToolDefinition[]
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>()
  return {
    register(d) {
      if (tools.has(d.type)) throw new Error(`Tool already registered: ${d.type}`)
      tools.set(d.type, d)
    },
    get(type) {
      const d = tools.get(type)
      if (!d) throw new Error(`Unknown tool: ${type}`)
      return d
    },
    list: () => [...tools.values()],
  }
}

export const toolRegistry: ToolRegistry = createToolRegistry()
