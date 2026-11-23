import { isFineWheelDelta } from './viewerMath'

/**
 * Whether the Ctrl key is physically held, read from keyboard and pointer
 * events. WebView2 reports touchpad pinch as a wheel event with `ctrlKey` set
 * synthetically, so a wheel event alone can't tell a pinch from a real
 * Ctrl + scroll; keyboard and pointer events carry the real modifier state.
 * Pointer moves also catch a Ctrl pressed while the window was unfocused.
 * Returns a getter and the disposer.
 */
export function trackCtrlKey(target: Window): { held: () => boolean; dispose: () => void } {
  let held = false
  const update = (e: KeyboardEvent | PointerEvent) => {
    held = e.ctrlKey
  }
  // A keyup outside the window is never seen.
  const clear = () => {
    held = false
  }
  const events = ['keydown', 'keyup', 'pointermove', 'pointerdown'] as const
  for (const type of events) target.addEventListener(type, update, { capture: true })
  target.addEventListener('blur', clear)
  return {
    held: () => held,
    dispose: () => {
      for (const type of events) target.removeEventListener(type, update, { capture: true })
      target.removeEventListener('blur', clear)
    },
  }
}

/**
 * What a Ctrl+wheel event does in the viewer: a touchpad pinch (Ctrl not
 * physically held) and Ctrl + mouse wheel zoom; Ctrl + two-finger scroll on the
 * touchpad or a free-spin mouse (Ctrl held, fine-grained deltas) scrolls as if
 * Ctrl weren't held. Null for a plain wheel event, which scrolls natively.
 */
export function ctrlWheelAction(e: WheelEvent, ctrlHeld: boolean): 'zoom' | 'scroll' | null {
  if (!e.ctrlKey) return null
  return ctrlHeld && isFineWheelDelta(e.deltaY, e.deltaMode) ? 'scroll' : 'zoom'
}
