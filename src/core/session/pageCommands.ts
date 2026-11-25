import { frameSize, layoutLines, normalizeRotation } from '../geometry/textLayout'
import type { PageExplanations } from './explanations'
import type { Command } from './history.svelte'
import { newId, type Annotation, type Rect } from './model'
import {
  insertEntry, remapForDelete, remapForInsert, removeEntry, rotateEntry, type PageEntry,
} from './pages'
import type { AnnotationStore } from './store.svelte'

/**
 * Owner of the page list the page commands edit (the DocumentSession). Its
 * explanation slots (one per page), if it has them, move with their pages.
 */
export interface PageHost {
  pages: PageEntry[]
  explanations?: PageExplanations
}

/**
 * One undo step changing the page list and the annotations together. The
 * first `do` computes the new page list (`apply`); undo puts back the exact
 * previous list and every annotation object that `apply` moved, redo the
 * computed list again.
 */
function pageCommand(
  label: string,
  host: PageHost,
  apply: (s: AnnotationStore, pages: PageEntry[]) => PageEntry[],
  revert: (s: AnnotationStore) => void,
  reindex?: (explanations: PageExplanations) => PageExplanations,
): Command {
  let before: PageEntry[] = []
  let after: PageEntry[] | null = null
  let explanationsBefore: PageExplanations | undefined
  /** Annotations as they were before `apply` moved or replaced them. */
  let originals: Annotation[] = []
  return {
    label,
    do: (s) => {
      before = host.pages
      originals = s.all()
      const next = apply(s, before)
      after ??= next
      host.pages = after
      // Computed from the slots at the time (an explanation edited after an
      // undo is redone in its new place, not reset to an old copy).
      explanationsBefore = host.explanations
      if (reindex && explanationsBefore) host.explanations = reindex(explanationsBefore)
    },
    undo: (s) => {
      revert(s)
      // Same ids, same pages again: restore the exact objects (z-order unchanged).
      for (const a of originals) if (s.get(a.id) !== a && s.get(a.id)?.page === a.page) s.update(a.id, a)
      host.pages = before
      if (explanationsBefore) host.explanations = explanationsBefore
    },
  }
}

/** `list` with `items` inserted at `at`. */
function spliced<T>(list: readonly T[], at: number, items: readonly T[]): T[] {
  const next = list.slice()
  next.splice(at, 0, ...items)
  return next
}

/** Copy of a page after it, with independent copies (new ids) of its annotations. */
export function duplicatePage(host: PageHost, i: number): Command {
  let copies: Annotation[] | null = null
  return pageCommand(
    'Duplicate page',
    host,
    (s, pages) => {
      copies ??= s.byPage(i).map((a) => ({ ...a, id: newId(), page: i + 1, sourceRef: null }))
      s.remapPages(remapForInsert(i + 1))
      copies.forEach((a) => s.add(a))
      return insertEntry(pages, i + 1, { ...pages[i] })
    },
    (s) => {
      copies?.forEach((a) => s.remove(a.id))
      s.remapPages((p) => remapForDelete(i + 1)(p) ?? p)
    },
    // The copy keeps the page's explanation.
    (ex) => spliced(ex, i + 1, [ex[i] ?? null]),
  )
}

/** Deletes page `i` and its annotations; null when it is the only page. */
export function deletePage(host: PageHost, i: number): Command | null {
  if (host.pages.length <= 1) return null
  let removed: Annotation[] = []
  return pageCommand(
    'Delete page',
    host,
    (s, pages) => {
      removed = s.byPage(i)
      removed.forEach((a) => s.remove(a.id))
      s.remapPages((p) => remapForDelete(i)(p) ?? p)
      return removeEntry(pages, i)
    },
    (s) => {
      s.remapPages(remapForInsert(i))
      // In z-order: each add lands at the end of the page.
      removed.forEach((a) => s.add(a))
    },
    (ex) => ex.filter((_, k) => k !== i),
  )
}

/** Inserts an empty page after page `after`. */
export function insertBlankPage(
  host: PageHost,
  after: number,
  blank: { width: number; height: number; rotate: number },
): Command {
  return pageCommand(
    'Insert empty page',
    host,
    (s, pages) => {
      s.remapPages(remapForInsert(after + 1))
      return insertEntry(pages, after + 1, { kind: 'blank', ...blank })
    },
    (s) => s.remapPages((p) => remapForDelete(after + 1)(p) ?? p),
    // A new empty page has no explanation.
    (ex) => spliced(ex, after + 1, [null]),
  )
}

/**
 * `r` turned a quarter about its centre (width and height swapped), then
 * kept inside `box` when given: scaled down about its centre (keeping the
 * aspect ratio) only if it is larger than the box, then shifted in.
 */
export function turnedRect(r: Rect, box?: Rect): Rect {
  const cx = (r[0] + r[2]) / 2
  const cy = (r[1] + r[3]) / 2
  let w = r[3] - r[1]
  let h = r[2] - r[0]
  if (!box) return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
  const k = Math.min(1, (box[2] - box[0]) / w, (box[3] - box[1]) / h)
  w *= k
  h *= k
  const x1 = Math.min(Math.max(cx - w / 2, box[0]), box[2] - w)
  const y1 = Math.min(Math.max(cy - h / 2, box[1]), box[3] - h)
  return [x1, y1, x1 + w, y1 + h]
}

/**
 * Turns page `i` by `delta` (±90) degrees. `fileRotation` is the /Rotate of
 * its file page (0 for an empty page, whose rotation is absolute): text boxes
 * on the page stay upright on screen, so they are wrapped again to their
 * width at the new rotation; pasted images stay upright and keep their shape
 * on screen, so their rect turns a quarter about its centre, kept inside
 * `pageBox` (the page's unrotated user-space box) when given.
 */
export function rotatePage(host: PageHost, i: number, delta: number, fileRotation: number, pageBox?: Rect): Command {
  return pageCommand(
    'Rotate page',
    host,
    (s, pages) => {
      const next = rotateEntry(pages, i, delta)
      turnAnnotations(s, i, fileRotation + next[i].rotate, delta, pageBox)
      return next
    },
    () => {},
  )
}

/** Sorted, distinct, in-range page indices. */
function normalizeIndices(host: PageHost, indices: Iterable<number>): number[] {
  const n = host.pages.length
  return [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b)
}

/**
 * Copies of the pages `indices` (in page order), inserted together right
 * after the last of them, with independent copies (new ids) of their
 * annotations. Null when `indices` is empty.
 */
export function duplicatePages(host: PageHost, indices: Iterable<number>): Command | null {
  const list = normalizeIndices(host, indices)
  if (list.length === 0) return null
  const last = list[list.length - 1]
  const n = list.length
  let copies: Annotation[] | null = null
  return pageCommand(
    n === 1 ? 'Duplicate page' : 'Duplicate pages',
    host,
    (s, pages) => {
      copies ??= list.flatMap((i, k) =>
        s.byPage(i).map((a) => ({ ...a, id: newId(), page: last + 1 + k, sourceRef: null })),
      )
      s.remapPages((p) => (p > last ? p + n : p))
      copies.forEach((a) => s.add(a))
      const next = pages.slice()
      next.splice(last + 1, 0, ...list.map((i) => ({ ...pages[i] })))
      return next
    },
    (s) => {
      copies?.forEach((a) => s.remove(a.id))
      s.remapPages((p) => (p > last + n ? p - n : p))
    },
    (ex) => spliced(ex, last + 1, list.map((i) => ex[i] ?? null)),
  )
}

/**
 * Deletes the pages `indices` and their annotations; null when that would
 * leave no page (or `indices` is empty).
 */
export function deletePages(host: PageHost, indices: Iterable<number>): Command | null {
  const list = normalizeIndices(host, indices)
  if (list.length === 0 || list.length >= host.pages.length) return null
  const gone = new Set(list)
  /** New index of each kept page (old index → new index). */
  const shift = (p: number) => p - list.filter((i) => i < p).length
  let removed: Annotation[] = []
  return pageCommand(
    list.length === 1 ? 'Delete page' : 'Delete pages',
    host,
    (s, pages) => {
      removed = list.flatMap((i) => s.byPage(i))
      removed.forEach((a) => s.remove(a.id))
      s.remapPages(shift)
      return pages.filter((_, i) => !gone.has(i))
    },
    (s) => {
      // Back to the old indices: the k-th kept page returns to its old position.
      // (host.pages is still the shortened list here.)
      const back = new Map<number, number>()
      for (let old = 0, k = 0; old < list.length + host.pages.length; old++) {
        if (!gone.has(old)) back.set(k++, old)
      }
      s.remapPages((p) => back.get(p) ?? p)
      // In z-order: each add lands at the end of its page.
      removed.forEach((a) => s.add(a))
    },
    (ex) => ex.filter((_, k) => !gone.has(k)),
  )
}

/** One page to turn: its index, its file page's /Rotate and its unrotated user-space box. */
export interface PageTurn {
  i: number
  fileRotation: number
  pageBox?: Rect
}

/**
 * Turns several pages by `delta` (±90) degrees in one step; see rotatePage
 * for what happens to their text boxes and images.
 */
export function rotatePages(host: PageHost, turns: readonly PageTurn[], delta: number): Command | null {
  if (turns.length === 0) return null
  return pageCommand(
    turns.length === 1 ? 'Rotate page' : 'Rotate pages',
    host,
    (s, pages) => {
      let next = pages
      for (const { i, fileRotation, pageBox } of turns) {
        if (!next[i]) continue
        next = rotateEntry(next, i, delta)
        turnAnnotations(s, i, fileRotation + next[i].rotate, delta, pageBox)
      }
      return next
    },
    () => {},
  )
}

/** Re-wraps the text boxes and turns the image rects of page `i` after it turned by `delta` to `rotation`. */
function turnAnnotations(s: AnnotationStore, i: number, rotation: number, delta: number, pageBox?: Rect): void {
  for (const a of s.byPage(i)) {
    if (a.kind === 'freetext') {
      s.update(a.id, { ...a, lines: layoutLines(a.text, a.fontSize, frameSize(a.rect, rotation).width, a.bold) })
    } else if (a.kind === 'image' && normalizeRotation(delta) % 180 !== 0) {
      s.update(a.id, { ...a, rect: turnedRect(a.rect, pageBox) })
    }
  }
}
