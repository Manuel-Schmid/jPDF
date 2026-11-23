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
 * Whether a Ctrl+wheel event zooms the document: a touchpad pinch (Ctrl not
 * physically held) or Ctrl + mouse wheel do; Ctrl + two-finger scroll on the
 * touchpad (Ctrl held, fine-grained deltas) does not.
 */
export function ctrlWheelZooms(e: WheelEvent, ctrlHeld: boolean): boolean {
  if (!e.ctrlKey) return false
  return !ctrlHeld || !isFineWheelDelta(e.deltaY, e.deltaMode)
}
