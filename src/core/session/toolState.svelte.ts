import type { LassoPath, PageFrame, TextEdit } from '../registry/tools'
import type { Annotation } from './model'

/**
 * Per-session tool state: selection and the live (uncommitted) preview annotation.
 *
 * Each DocumentSession creates its own when it is constructed. It must never be
 * created lazily by its first reader: Svelte does not track state created inside
 * the reaction (derived/effect) that is running, so a derived that created it
 * would never see later changes (live strokes stayed invisible until pointerup).
 */
export class SessionToolState {
  selection = $state<string[]>([])
  preview = $state.raw<Annotation | null>(null)
  /** Live annotations, any number per page (see ToolContext.pagePreviews). */
  pagePreviews = $state.raw<readonly Annotation[]>([])
  /** The lasso being drawn (see ToolContext.lasso). */
  lasso = $state.raw<LassoPath | null>(null)
  hidden = $state.raw<ReadonlySet<string>>(new Set())
  cursor = $state<string | null>(null)
  textEdit = $state.raw<TextEdit | null>(null)
  /** Cross-page drag in progress, started on this page (0-based). */
  crossDrag = $state.raw<{ page: number; at?: number } | null>(null)
  /** Tooltip on a page (see ToolContext.hint). */
  hint = $state.raw<{ page: number; text: string } | null>(null)
  /** Mounted pages' frames by 0-based page, registered by their overlays (not reactive). */
  readonly frames = new Map<number, () => PageFrame | null>()
}
