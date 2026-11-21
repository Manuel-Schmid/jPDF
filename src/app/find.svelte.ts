import { commands as defaultCommands, type CommandRegistry } from '../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../core/registry/keybindings'
import type { DocumentSession } from '../core/session/session.svelte'
import { pageLeft } from '../core/viewer/layout'
import { sourceViewport } from '../core/viewer/pageSource'
import {
  findAll,
  hitQuads,
  normalizeQuery,
  quadsBounds,
  quadToViewport,
  revealScroll,
  type SearchHit,
  type SearchView,
} from '../core/viewer/search'
import { pageTextOf } from '../core/viewer/textContent'
import { tabs } from './tabs.svelte'

const DEBOUNCE_MS = 150
/** While a long document is searched, the hit count updates at most this often. */
const PUBLISH_MS = 100

/**
 * Search in the active tab (the title bar's search field). Text is indexed
 * lazily, page by page, on the first search and cached per document (see
 * pageTextOf). Typing is debounced; a new query, another tab or a page edit
 * starts the search over and drops the one in flight.
 */
export class FindState {
  /** Whether the search field is shown. */
  open = $state(false)
  query = $state('')
  /** Hits in page order. */
  hits = $state.raw<SearchHit[]>([])
  current = $state.raw<SearchHit | null>(null)
  /** Pages are still being searched (the hit count may grow). */
  searching = $state(false)
  /** Bumped to ask the search field to take focus. */
  focusRequests = $state(0)
  /** Session the hits belong to. */
  private owner = $state.raw<DocumentSession | null>(null)
  private token = 0

  readonly index = $derived(this.current ? this.hits.indexOf(this.current) : -1)
  readonly byPage: ReadonlyMap<number, readonly SearchHit[]> = $derived.by(() => {
    const m = new Map<number, SearchHit[]>()
    for (const h of this.hits) {
      const list = m.get(h.page)
      if (list) list.push(h)
      else m.set(h.page, [h])
    }
    return m
  })

  constructor(
    private active: () => DocumentSession | null,
    private debounceMs = DEBOUNCE_MS,
  ) {}

  /** Shows the field and focuses it (Ctrl+F). */
  show(): void {
    this.open = true
    this.focusRequests++
  }

  /** Clears the query and hides the field (Esc, close button). */
  close(): void {
    this.open = false
    this.query = ''
  }

  /** Highlights for `session`'s viewer; null when the hits are another tab's. */
  viewFor(session: DocumentSession): SearchView | null {
    if (!this.open || this.owner !== session || this.hits.length === 0) return null
    return { byPage: this.byPage, current: this.current }
  }

  next(): void {
    this.step(1)
  }

  previous(): void {
    this.step(-1)
  }

  private step(delta: number): void {
    const n = this.hits.length
    const s = this.owner
    if (n === 0 || !s) return
    const i = this.index < 0 ? (delta > 0 ? 0 : n - 1) : (this.index + delta + n) % n
    this.current = this.hits[i]
    void this.reveal(s, this.hits[i])
  }

  /** Re-runs the search whenever the query, the active tab or its pages change. Returns the disposer. */
  start(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const s = this.active()
        const q = this.open ? normalizeQuery(this.query) : ''
        // Read here so a page edit or a reload after save searches again.
        void s?.pages
        void s?.doc
        if (!s || q === '') {
          this.token++
          this.reset(s)
          return
        }
        const t = setTimeout(() => void this.run(s, q), this.debounceMs)
        return () => clearTimeout(t)
      })
      return () => this.token++
    })
  }

  private reset(owner: DocumentSession | null): void {
    this.owner = owner
    this.hits = []
    this.current = null
    this.searching = false
  }

  /**
   * Searches `s` for `q`, from the current page to the end and then from the
   * start, so the first hit to jump to is found early in a long document.
   */
  private async run(s: DocumentSession, q: string): Promise<void> {
    const token = ++this.token
    const pages = s.pages
    const doc = s.doc
    const n = pages.length
    const from = Math.min(Math.max(0, s.currentPage - 1), Math.max(0, n - 1))
    const perPage: SearchHit[][] = []
    let picked: SearchHit | null = null
    let published = 0
    this.owner = s
    this.searching = true
    const publish = () => {
      this.hits = perPage.flat()
      published = performance.now()
    }
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n
      const entry = pages[i]
      if (entry.kind !== 'source') continue
      let found: SearchHit[]
      try {
        const text = await pageTextOf(doc, entry.source)
        found = findAll(text.text, q).map((at) => ({ page: i, quads: hitQuads(text, at, at + q.length) }))
      } catch (e) {
        if (doc.destroyed) return
        console.error(`Failed to search page ${i + 1}`, e)
        found = []
      }
      if (token !== this.token) return
      if (found.length === 0) continue
      perPage[i] = found
      // The first hit at or after the current page: jump there as soon as it is known.
      if (!picked) {
        picked = found[0]
        publish()
        this.current = picked
        void this.reveal(s, picked)
      } else if (performance.now() - published > PUBLISH_MS) publish()
    }
    publish()
    if (!picked) this.current = null
    this.searching = false
  }

  /** Scrolls `s` so `hit` is in view (unchanged if it already is). */
  private async reveal(s: DocumentSession, hit: SearchHit): Promise<void> {
    const entry = s.pages[hit.page]
    if (entry?.kind !== 'source') return
    const page = await s.doc.getPage(entry.source + 1)
    if (s.pages[hit.page] !== entry) return
    const vp = sourceViewport(page, entry, s.scale)
    const b = quadsBounds(hit.quads.map((q) => quadToViewport(q, vp)))
    if (!Number.isFinite(b.left)) return
    const left = pageLeft(s.layout, hit.page, s.viewportW)
    const top = s.layout.tops[hit.page]
    const pos = revealScroll(
      { left: left + b.left, right: left + b.right, top: top + b.top, bottom: top + b.bottom },
      { top: s.scrollTop, left: s.scrollLeft, width: s.viewportW, height: s.viewportH },
    )
    if (pos.top !== s.scrollTop || pos.left !== s.scrollLeft) s.setScroll(pos.top, pos.left)
  }
}

export const find = new FindState(() => tabs.active)

/** Registers view.find (Ctrl+F): shows and focuses the search field. */
export function registerFindCommands(
  state: FindState,
  enabled: () => boolean,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = [
    commands.register({ id: 'view.find', title: 'Find', run: () => state.show(), enabled }),
    keybindings.bind('Ctrl+F', 'view.find'),
  ]
  return () => disposers.forEach((d) => d())
}
