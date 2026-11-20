/** Drag distance (px) before a press on a tool button becomes a reorder drag. */
export const DRAG_THRESHOLD = 4

/**
 * Insertion slot among the *other* visible buttons: how many of them have
 * their centre before `pointer`. Centres and pointer are coordinates along
 * the toolbar's axis (y for a vertical strip, x for a horizontal one).
 */
export function insertionIndex(centres: number[], dragged: number, pointer: number): number {
  return centres.filter((c, i) => i !== dragged && c < pointer).length
}

/**
 * Converts an insertion slot among the other visible instances into the
 * `toIndex` for `SettingsStore.move` on the full toolbar (which may contain
 * hidden instances of unregistered tools). Null when the order would not change.
 */
export function reorderTarget(full: string[], visible: string[], dragged: string, slot: number): number | null {
  const rest = visible.filter((id) => id !== dragged)
  const fullRest = full.filter((id) => id !== dragged)
  let to: number
  if (slot < rest.length) to = fullRest.indexOf(rest[slot])
  else to = rest.length ? fullRest.indexOf(rest[rest.length - 1]) + 1 : 0
  return to === full.indexOf(dragged) ? null : to
}
