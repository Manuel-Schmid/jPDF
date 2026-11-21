import type { DocumentSession, ViewAnchor } from '../core/session/session.svelte'
import type { SettingsStore } from '../core/settings/settings.svelte'

/** Fallback when the viewer never reports a size change. */
export const SETTLE_MS = 500

/**
 * Puts the page position captured in `anchor` back once the viewer has
 * resized (a layout change such as fullscreen or moving the toolbar). The
 * timer only covers "no resize came", e.g. a toolbar moved from the right to
 * the left edge keeps the viewer's size.
 */
export async function restoreAfterResize(anchor: ViewAnchor, settleMs = SETTLE_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([anchor.resized, new Promise<void>((r) => (timer = setTimeout(r, settleMs)))])
  clearTimeout(timer)
  anchor.restore()
}

/** The settings a reopened document's view is kept in. */
type ViewStore = Pick<SettingsStore, 'data' | 'rememberView' | 'viewFor'>

/**
 * On close (of the tab or the app): records the page and zoom the document
 * was left at, so it reopens there. Nothing is recorded when reopening at
 * the first page is chosen, or for a tab never shown (it keeps the view it
 * was opened with).
 */
export function rememberView(store: ViewStore, s: DocumentSession): void {
  if (store.data.preferences.reopenAt !== 'last') return
  const view = s.currentView()
  if (view) store.rememberView({ path: s.path, ...view })
}

/** On open: makes the document's first display restore where it was left, if remembered. */
export function restoreView(store: ViewStore, s: DocumentSession): void {
  if (store.data.preferences.reopenAt !== 'last') return
  const view = store.viewFor(s.path)
  if (view) s.initialView = { page: view.page, offset: view.offset, scale: view.scale }
}
