import { eyedropper } from '../core/viewer/eyedropper.svelte'

export interface DismissOptions {
  onclose(): void
  /** Pointer-downs inside these elements do not count as outside (e.g. the anchor button). */
  ignore?: (Element | null | undefined)[]
}

/**
 * Svelte action for popups: Escape and pointer-down outside the node call
 * `onclose`. Escape is consumed (capture phase on window, stopPropagation) so
 * the app keybindings do not also act on it; with no popup open nothing is
 * listening and Escape passes through. While the eyedropper picks, Escape
 * is the pick's (it cancels only the pick, see eyedropper.svelte.ts).
 */
export function dismissable(node: HTMLElement, opts: DismissOptions) {
  let o = opts
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || eyedropper.active) return
    e.preventDefault()
    e.stopPropagation()
    o.onclose()
  }
  const onPointer = (e: PointerEvent) => {
    const t = e.target as Node | null
    if (t && (node.contains(t) || o.ignore?.some((el) => el?.contains(t)))) return
    o.onclose()
  }
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  return {
    update(next: DismissOptions) {
      o = next
    },
    destroy() {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    },
  }
}
