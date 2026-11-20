import { chordFromEvent } from '../core/registry/keybindings'

/**
 * WebView shortcuts that would make the app behave like a web page: reload,
 * print, find in page, caret browsing, view source, and back / forward
 * navigation. Page zoom (Ctrl+± / Ctrl+0) is already off through
 * `zoomHotkeysEnabled: false`, Ctrl+wheel through `guardPageZoom`. The
 * DevTools chords (F12, Ctrl+Shift+I/J/C) are left alone: they help in
 * `tauri dev`, and release builds have no DevTools to open.
 */
export const BROWSER_CHORDS: ReadonlySet<string> = new Set([
  'F5',
  'Ctrl+F5',
  'Shift+F5',
  'Ctrl+R',
  'Ctrl+Shift+R',
  'Ctrl+P',
  'Ctrl+Shift+P',
  'Ctrl+F',
  'F3',
  'Shift+F3',
  'Ctrl+G',
  'Ctrl+Shift+G',
  'F7',
  'Ctrl+U',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'BrowserBack',
  'BrowserForward',
  'BrowserRefresh',
  'BrowserSearch',
])

/** Dragging stays possible where it means something: text in a field, or an element made draggable on purpose. */
const DRAG_ALLOWED =
  'input, textarea, [contenteditable]:not([contenteditable="false"]), [draggable="true"]'

/**
 * Keeps WebView behavior from showing through so the app feels native: no
 * default context menu (Back, Reload, Inspect …), no browser shortcuts, no
 * dragging of UI chrome. Only the default action is cancelled, never
 * propagation, so the app's own context menus and keybindings (which may
 * reuse any of these chords) still receive the events. Returns the disposer.
 */
export function guardBrowserBehavior(target: Window): () => void {
  const onContextMenu = (e: Event) => e.preventDefault()
  const onKeyDown = (e: KeyboardEvent) => {
    if (BROWSER_CHORDS.has(chordFromEvent(e))) e.preventDefault()
  }
  const onDragStart = (e: DragEvent) => {
    const t = e.target
    if (!(t instanceof Element && t.closest(DRAG_ALLOWED))) e.preventDefault()
  }
  target.addEventListener('contextmenu', onContextMenu)
  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('dragstart', onDragStart)
  return () => {
    target.removeEventListener('contextmenu', onContextMenu)
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('dragstart', onDragStart)
  }
}
