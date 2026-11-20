/** Drag distance (px) before a press on a tool button becomes a reorder drag. */
export const DRAG_THRESHOLD = 4

/** Duration (ms) of the slot-to-slot slide while reordering (CSS transition on transform). */
export const SLIDE_MS = 150

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

/**
 * Offset (px along the toolbar's axis) for each visible button while the one
 * at `dragged` sits in insertion `slot` among the others. `starts` are the
 * buttons' leading edges as laid out at drag start; all tool buttons are the
 * same size, so position k of the new order is simply `starts[k]`. The
 * dragged button jumps to its slot and the ones in between shift one slot
 * back toward its original place; the rest stay at 0.
 */
export function slotOffsets(starts: number[], dragged: number, slot: number): number[] {
  return starts.map((start, i) => {
    let to: number
    if (i === dragged) to = slot
    else {
      const j = i < dragged ? i : i - 1 // index among the others
      to = j < slot ? j : j + 1
    }
    return starts[to] - start
  })
}
