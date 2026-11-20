import type { ViewAnchor } from '../core/session/session.svelte'

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
