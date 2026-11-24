/**
 * Touchpad pinch reaches the page as Ctrl+wheel (the WebView has pinch enabled
 * so the viewer can zoom documents), as does Ctrl + scroll. Any Ctrl+wheel the
 * viewer does not handle — Ctrl + two-finger scroll, or anything over
 * the toolbar, tabs, or with no document open — must be cancelled, or the
 * WebView would zoom the whole interface instead. Touchscreen pinch never
 * gets here: `touch-action` turns it off (base.css) and the viewer handles it
 * with touch events. Returns the disposer.
 */
export function guardPageZoom(target: Window): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault()
  }
  target.addEventListener('wheel', onWheel, { passive: false })
  return () => target.removeEventListener('wheel', onWheel)
}
