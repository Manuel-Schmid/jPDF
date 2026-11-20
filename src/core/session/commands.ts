import type { Command } from './history.svelte'
import type { Annotation } from './model'
import type { AnnotationStore } from './store.svelte'

export function addAnnotations(list: Annotation[]): Command {
  return {
    label: 'Add annotation',
    do: (s) => list.forEach((a) => s.add(a)),
    undo: (s) => [...list].reverse().forEach((a) => s.remove(a.id)),
  }
}

export function updateAnnotation(before: Annotation, after: Annotation): Command {
  return {
    label: 'Edit annotation',
    do: (s) => s.update(before.id, after),
    undo: (s) => s.update(before.id, before),
  }
}

export function deleteAnnotations(list: Annotation[]): Command {
  // Per-page z-index of each annotation at delete time, so undo restores order.
  let slots: { a: Annotation; index: number }[] = []
  return {
    label: 'Delete annotation',
    do: (s) => {
      slots = list.map((a) => ({ a, index: s.byPage(a.page).findIndex((x) => x.id === a.id) }))
      list.forEach((a) => s.remove(a.id))
    },
    undo: (s) => {
      // Ascending index per page: each insert lands at its original position.
      const sorted = slots.slice().sort((x, y) => x.a.page - y.a.page || x.index - y.index)
      for (const { a, index } of sorted) s.add(a, index < 0 ? undefined : index)
    },
  }
}

/** Moves several annotations as one undo step: each `before` becomes the `after` with its id. */
export function updateAnnotations(label: string, changes: { before: Annotation; after: Annotation }[]): Command {
  return compositeCommand(label, changes.map(({ before, after }) => updateAnnotation(before, after)))
}

/**
 * Marks annotations flattened (burned into the page content on the next
 * save; see Base.flattened), one undo step. Already flattened ones are skipped.
 */
export function flattenAnnotations(list: Annotation[], modifiedAt = new Date().toISOString()): Command {
  return updateAnnotations(
    'Flatten annotations',
    list.filter((a) => !a.flattened).map((a) => ({ before: a, after: { ...a, flattened: true, modifiedAt } })),
  )
}

/** A change of stacking order: to the top or bottom of the page, or one step up or down. */
export type ZOrder = 'front' | 'forward' | 'backward' | 'back'

/** What each z-order change is called (undo step, menu item). */
export const Z_ORDER_LABELS: Record<ZOrder, string> = {
  front: 'Bring to front',
  forward: 'Bring forward',
  backward: 'Send backward',
  back: 'Send to back',
}

/**
 * A page's z-order `ids` (bottom first) with the `moved` ids restacked as
 * `how` says. Moved and unmoved ids each keep their relative order; a step
 * moves a block of adjacent moved ids past one other id.
 */
export function restack(ids: readonly string[], moved: ReadonlySet<string>, how: ZOrder): string[] {
  const out = ids.slice()
  const swap = (i: number, j: number) => ([out[i], out[j]] = [out[j], out[i]])
  if (how === 'front' || how === 'back') {
    const rest = ids.filter((id) => !moved.has(id))
    const top = ids.filter((id) => moved.has(id))
    return how === 'front' ? [...rest, ...top] : [...top, ...rest]
  }
  // Walking against the direction of travel moves a block up (down) as a whole.
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (moved.has(out[i]) && !moved.has(out[i + 1])) swap(i, i + 1)
  } else {
    for (let i = 1; i < out.length; i++) if (moved.has(out[i]) && !moved.has(out[i - 1])) swap(i, i - 1)
  }
  return out
}

/** The pages whose z-order restacking `list` changes, with their order before and after. */
export function restackedPages(
  s: Pick<AnnotationStore, 'get' | 'byPage'>,
  list: readonly Annotation[],
  how: ZOrder,
): { page: number; before: string[]; after: string[] }[] {
  const moved = new Set(list.map((a) => a.id))
  const pages = new Set(list.flatMap((a) => s.get(a.id)?.page ?? []))
  return [...pages].flatMap((page) => {
    const before = s.byPage(page).map((a) => a.id)
    const after = restack(before, moved, how)
    return after.some((id, i) => id !== before[i]) ? [{ page, before, after }] : []
  })
}

/** Restacks `list` (on any pages) as one undo step; undo restores each page's order. */
export function reorderAnnotations(list: readonly Annotation[], how: ZOrder): Command {
  let changes: ReturnType<typeof restackedPages> = []
  return {
    label: Z_ORDER_LABELS[how],
    do: (s) => {
      changes = restackedPages(s, list, how)
      for (const { page, after } of changes) s.reorder(page, after)
    },
    undo: (s) => {
      for (const { page, before } of changes) s.reorder(page, before)
    },
  }
}

/** One undo step made of `parts`: done in order, undone in reverse. */
export function compositeCommand(label: string, parts: Command[]): Command {
  return {
    label,
    do: (s) => parts.forEach((c) => c.do(s)),
    undo: (s) => [...parts].reverse().forEach((c) => c.undo(s)),
  }
}

/**
 * Merges `absorbed` into `before` (the survivor, which keeps its id, file
 * object and z-position) as `after`. Undo restores every original, in its
 * original order.
 */
export function mergeAnnotations(before: Annotation, after: Annotation, absorbed: Annotation[]): Command {
  return compositeCommand('Merge annotations', [deleteAnnotations(absorbed), updateAnnotation(before, after)])
}
