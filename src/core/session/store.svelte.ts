import { SvelteMap } from 'svelte/reactivity'
import type { Annotation } from './model'

/**
 * Annotations of one document. Reactive per annotation id and per page, so a
 * page component re-renders only when its own annotations change.
 *
 * The store owns `sourceRef`: it keeps the file object of each annotation id
 * (surviving removal), and add()/update() overwrite the incoming object's
 * sourceRef with it. So objects held by undo/redo commands never resurrect a
 * stale ref (e.g. null after the annotation was saved).
 *
 * Change tracking: an annotation is in changedSince() if it was added or
 * updated since load/markSaved and is still present (a re-added annotation
 * counts as added, even if unchanged since the last save). deletedSourceRefs()
 * are the refs of ids that have a file object but are currently absent;
 * re-adding one drops it from that set. pageOrders() are the pages whose
 * z-order changed (reorder(), or an insert below the top) since then.
 */
/** A deleted annotation's id and the file object it was saved as. */
export interface DeletedRef { id: string; sourceRef: string }

/**
 * The z-order of a page's annotations (bottom first) to write into its
 * `/Annots`, each with the file object it was saved as (null when new).
 * Same JSON shape as Rust `PageOrder`.
 */
export interface PageOrder { page: number; annotations: { id: string; sourceRef: string | null }[] }

export class AnnotationStore {
  private byId = new SvelteMap<string, Annotation>()
  private pages = new SvelteMap<number, Annotation[]>()
  private changed = new Set<string>()
  /** id -> sourceRef of the annotation's object in the file (kept while removed). */
  private refs = new Map<string, string>()
  /** Pages whose z-order changed since load/markSaved. */
  private reordered = new Set<number>()

  /** Insertion order = z-order. */
  byPage(page: number): Annotation[] {
    return this.pages.get(page) ?? []
  }

  get(id: string): Annotation | undefined {
    return this.byId.get(id)
  }

  /** Ordered by page, then z-order within the page (same order as byPage). */
  all(): Annotation[] {
    return [...this.pages.keys()].sort((x, y) => x - y).flatMap((p) => this.byPage(p))
  }

  /** Adds at the end of the page's z-order, or at `index` (clamped) if given. */
  add(input: Annotation, index?: number): void {
    if (this.byId.has(input.id)) throw new Error(`Annotation ${input.id} already exists`)
    const a = this.withRef(input)
    this.byId.set(a.id, a)
    const list = this.byPage(a.page).slice()
    // Below the top: the writer would append it, so the page's order must be written.
    if (index !== undefined && index < list.length) this.reordered.add(a.page)
    list.splice(index === undefined ? list.length : Math.max(0, index), 0, a)
    this.pages.set(a.page, list)
    this.changed.add(a.id)
  }

  update(id: string, input: Annotation): void {
    const old = this.byId.get(id)
    if (!old) throw new Error(`Annotation ${id} not found`)
    if (input.id !== id) throw new Error('update must not change the id')
    const next = this.withRef(input)
    this.byId.set(id, next)
    if (old.page === next.page) {
      this.pages.set(old.page, this.byPage(old.page).map((x) => (x.id === id ? next : x)))
    } else {
      this.dropFromPage(old)
      this.pages.set(next.page, [...this.byPage(next.page), next])
    }
    this.changed.add(id)
  }

  /**
   * Sets the z-order of page `page` (bottom first); `ids` must be exactly
   * the ids of its annotations.
   */
  reorder(page: number, ids: readonly string[]): void {
    const current = this.byPage(page)
    const list = ids.map((id) => this.byId.get(id))
    if (list.length !== current.length || new Set(ids).size !== ids.length || list.some((a) => a?.page !== page)) {
      throw new Error(`reorder must list every annotation of page ${page} once`)
    }
    if (list.every((a, i) => a === current[i])) return
    this.pages.set(page, list as Annotation[])
    this.reordered.add(page)
  }

  remove(id: string): void {
    const old = this.byId.get(id)
    if (!old) return
    this.byId.delete(id)
    this.dropFromPage(old)
    this.changed.delete(id)
  }

  /**
   * Moves every annotation on page p to page `to(p)` (page operations: pages
   * inserted or deleted before it), keeping each page's z-order. Moved
   * annotations count as changed. `to` must map pages that have annotations
   * to distinct pages.
   */
  remapPages(to: (page: number) => number): void {
    const moves = [...this.pages].map(([p, list]) => ({ p, q: to(p), list })).filter((m) => m.q !== m.p)
    if (new Set([...this.pages.keys()].map(to)).size !== this.pages.size) {
      throw new Error('remapPages must not merge pages')
    }
    this.reordered = new Set([...this.reordered].map(to))
    for (const { p } of moves) this.pages.delete(p)
    for (const { q, list } of moves) {
      const moved = list.map((a) => ({ ...a, page: q }))
      for (const a of moved) {
        this.byId.set(a.id, a)
        this.changed.add(a.id)
      }
      this.pages.set(q, moved)
    }
  }

  /** Replaces all content with annotations read from the file. */
  load(list: Annotation[]): void {
    this.byId.clear()
    this.pages.clear()
    this.refs.clear()
    for (const a of list) if (a.sourceRef) this.refs.set(a.id, a.sourceRef)
    const perPage = new Map<number, Annotation[]>()
    for (const a of list) {
      this.byId.set(a.id, a)
      perPage.set(a.page, [...(perPage.get(a.page) ?? []), a])
    }
    for (const [p, l] of perPage) this.pages.set(p, l)
    this.changed.clear()
    this.reordered.clear()
  }

  /** Deleted annotations that exist in the file, as id + sourceRef (the writer checks both match). */
  deletedRefs(): DeletedRef[] {
    const out: DeletedRef[] = []
    for (const [id, sourceRef] of this.refs) if (!this.byId.has(id)) out.push({ id, sourceRef })
    return out
  }

  deletedSourceRefs(): string[] {
    const out: string[] = []
    for (const [id, ref] of this.refs) if (!this.byId.has(id)) out.push(ref)
    return out
  }

  /** The z-order of every page reordered since load/markSaved. */
  pageOrders(): PageOrder[] {
    return [...this.reordered]
      .sort((x, y) => x - y)
      .map((page) => ({ page, annotations: this.byPage(page).map((a) => ({ id: a.id, sourceRef: a.sourceRef })) }))
  }

  changedSince(): Annotation[] {
    return this.all().filter((a) => this.changed.has(a.id))
  }

  /**
   * Records a completed save (without counting as a change) and clears
   * changedSince(): `refs` are the sourceRefs the save assigned (id -> ref),
   * `deleted` the sourceRefs it removed from the file. Ids whose object was
   * deleted lose their ref, so re-adding one later writes a new object.
   * `orders` are the page orders the save wrote: a page reordered again
   * meanwhile (or not written) stays in pageOrders().
   */
  markSaved(refs: Record<string, string>, deleted: readonly string[], orders: readonly PageOrder[] = []): void {
    const ids = (list: readonly { id: string }[]) => list.map((a) => a.id).join('\n')
    const written = new Map(orders.map((o) => [o.page, ids(o.annotations)]))
    for (const p of this.reordered) if (written.get(p) === ids(this.byPage(p))) this.reordered.delete(p)
    const gone = new Set(deleted)
    const touched = new Set<string>()
    for (const [id, ref] of this.refs) {
      if (gone.has(ref)) {
        this.refs.delete(id)
        touched.add(id)
      }
    }
    for (const [id, ref] of Object.entries(refs)) {
      this.refs.set(id, ref)
      touched.add(id)
    }
    for (const id of touched) {
      const a = this.byId.get(id)
      if (!a) continue
      const next = this.withRef(a)
      if (next === a) continue
      this.byId.set(id, next)
      this.pages.set(a.page, this.byPage(a.page).map((x) => (x.id === id ? next : x)))
    }
    this.changed.clear()
  }

  private dropFromPage(a: Annotation): void {
    const rest = this.byPage(a.page).filter((x) => x.id !== a.id)
    if (rest.length) this.pages.set(a.page, rest)
    else this.pages.delete(a.page)
  }

  /** `a` with the store's sourceRef for its id (the same object if it already matches). */
  private withRef(a: Annotation): Annotation {
    const ref = this.refs.get(a.id) ?? null
    return a.sourceRef === ref ? a : { ...a, sourceRef: ref }
  }
}
