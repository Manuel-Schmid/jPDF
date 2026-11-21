import { openPdf, readAnnotations } from '../ipc/api'
import {
  clampScale, computeLayout, contentWidth, fitWidthScale, initialScale, pageAt, pageLeft, zoomAround, PAGE_GAP, type Layout,
} from '../viewer/layout'
import { loadPdf, type PdfDoc } from '../viewer/pdfEngine'
import { renderCache } from '../viewer/renderCache'
import { thumbnailCache } from '../viewer/thumbnails'
import { frameSize, layoutLines, normalizeRotation } from '../geometry/textLayout'
import { toasts } from '../../ui/toasts.svelte'
import { History } from './history.svelte'
import type { Annotation, Rect } from './model'
import {
  deletePage, deletePages, duplicatePage, duplicatePages, insertBlankPage, rotatePage, rotatePages, type PageTurn,
} from './pageCommands'
import { identityPages, isIdentity, pagePlan, pageSizesOf, type PageEntry, type PageSize, type PageSpec } from './pages'
import { AnnotationStore } from './store.svelte'
import { SessionToolState } from './toolState.svelte'
import type { DocumentView } from '../settings/viewMemory'

export interface ViewAnchor {
  /** Resolves when the viewport size next changes. */
  resized: Promise<void>
  restore(): void
}

export type { PageSize } from './pages'

/** A document read by DocumentSession.loadSaved, not yet applied. */
export interface ReloadedDocument {
  doc: PdfDoc
  annotations: Annotation[]
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

const SIZE_CHUNK = 16

/**
 * JuliePDF-managed annotations of the file. pdf.js opens some damaged files
 * the annotation reader rejects; those still open, without editable annotations.
 */
async function readManaged(path: string): Promise<Annotation[]> {
  try {
    return await readAnnotations(path)
  } catch (e) {
    console.error(`Failed to read annotations of ${path}`, e)
    toasts.show('Annotations in this file could not be loaded', 'warning')
    return []
  }
}

/**
 * The reader returns freetext annotations without `lines`: wraps their text
 * to each box's on-screen width (which depends on the page's /Rotate).
 */
async function withFreeTextLines(doc: PdfDoc, annotations: Annotation[]): Promise<Annotation[]> {
  const pages = [...new Set(annotations.filter((a) => a.kind === 'freetext').map((a) => a.page))]
  if (pages.length === 0) return annotations
  const rotations = new Map<number, number>()
  await Promise.all(
    pages.map(async (p) => {
      const page = await doc.getPage(p + 1).catch(() => null)
      rotations.set(p, page?.rotate ?? 0)
    }),
  )
  return annotations.map((a) =>
    a.kind === 'freetext'
      ? { ...a, lines: layoutLines(a.text, a.fontSize, frameSize(a.rect, rotations.get(a.page) ?? 0).width) }
      : a,
  )
}

async function pageSizeOf(doc: PdfDoc, page: number): Promise<PageSize> {
  const { width, height } = (await doc.getPage(page)).getViewport({ scale: 1 })
  return { width, height }
}

function sameSize(a: PageSize, b: PageSize): boolean {
  return a.width === b.width && a.height === b.height
}

export class DocumentSession {
  readonly id: string = crypto.randomUUID()
  /** Where the document is saved; changes on Save As. */
  path: string = $state('')
  fileName: string = $state('')
  #doc: PdfDoc = $state.raw(null as unknown as PdfDoc)
  /** The pdf.js document; replaced when a save that changed pages reloads the file. */
  get doc(): PdfDoc {
    return this.#doc
  }
  /**
   * The pages as shown, in order (page operations edit this list; see
   * pageCommands). Annotation.page indexes this list.
   */
  get pages(): PageEntry[] {
    return this.#pages
  }
  set pages(pages: PageEntry[]) {
    this.#pages = pages
    // A deleted current (last) page: the status bar must not show "3 / 2".
    if (this.currentPage > pages.length) this.currentPage = Math.max(1, pages.length)
  }
  #pages: PageEntry[] = $state.raw([])
  /**
   * Set when the session no longer matches its file (a save changed the
   * pages but reloading the saved file failed): it must not be saved again.
   */
  broken = $state(false)
  /**
   * Sizes of the file's pages at scale 1 (points, with their own /Rotate).
   * Starts as page 1's size for every page; the real sizes are filled in the
   * background (see pageSizesLoaded).
   */
  private sourceSizes: PageSize[] = $state.raw([])
  /** Display size of every page in `pages` at scale 1 (points). */
  readonly pageSizes: PageSize[] = $derived(pageSizesOf(this.pages, this.sourceSizes))
  /** Resolves once every page's real size is known (or the session is disposed). */
  readonly pageSizesLoaded: Promise<void>
  scale = $state(1)
  scrollTop = $state(0)
  scrollLeft = $state(0)
  /** 1-based page number shown in the status bar. */
  currentPage = $state(1)
  /** Size of the viewer's scroll viewport (client area), set by the Viewer. */
  viewportW = $state(0)
  viewportH = $state(0)
  /** False until initView has applied the initial fit-width scale. */
  viewInitialized = false

  readonly layout: Layout = $derived.by(() => computeLayout(this.pageSizes, this.scale))

  /** Set by goToPage so the echoing scroll event keeps the requested page. */
  private pinnedTop: number | null = null
  private disposed = false
  private viewportWaiters: (() => void)[] = []
  readonly store = new AnnotationStore()
  readonly history = new History(this.store)
  /** Selection and live tool preview; created here, never lazily (see SessionToolState). */
  readonly toolState = new SessionToolState()

  get dirty(): boolean {
    return this.history.isDirty
  }

  /**
   * Finishes an in-progress edit (an open text box), set by the tool that owns
   * it. Save and close call commitPendingEdit first so the edit is included.
   */
  pendingEdit: (() => void) | null = null

  commitPendingEdit(): void {
    const commit = this.pendingEdit
    this.pendingEdit = null
    commit?.()
  }

  private constructor(path: string, doc: PdfDoc, first: PageSize, annotations: Annotation[]) {
    this.setPath(path)
    this.#doc = doc
    // Before the first render: pdf.js must not draw what the overlay draws.
    this.suppress(annotations.flatMap((a) => (a.sourceRef ? [a.sourceRef] : [])))
    this.store.load(annotations)
    this.sourceSizes = Array.from({ length: doc.numPages }, () => first)
    this.pages = identityPages(doc.numPages)
    this.pageSizesLoaded = this.loadRemainingSizes().catch((e: unknown) => {
      if (!this.disposed) console.error(`Failed to read page sizes of ${path}`, e)
    })
  }

  /**
   * Opens a PDF with its JuliePDF-managed annotations. Resolves as soon as
   * page 1's size is known (fast first page).
   */
  static async open(path: string): Promise<DocumentSession> {
    const [bytes, read] = await Promise.all([openPdf(path), readManaged(path)])
    const doc = await loadPdf(bytes)
    try {
      const annotations = await withFreeTextLines(doc, read)
      return new DocumentSession(path, doc, await pageSizeOf(doc, 1), annotations)
    } catch (e) {
      await doc.destroy()
      throw e
    }
  }

  setPath(path: string): void {
    this.path = path
    this.fileName = fileNameOf(path)
  }

  /**
   * Hides annotations with these sourceRefs from pdf.js rendering. Refs stay
   * suppressed for the life of the pdf.js document (it keeps the bytes it was
   * opened with, so annotations deleted since loading must stay hidden too).
   */
  suppress(refs: Iterable<string>): void {
    this.doc.suppressAnnotations(refs)
  }

  private async loadRemainingSizes(): Promise<void> {
    // Let the first page's render request reach the worker before ours.
    await new Promise((r) => setTimeout(r, 0))
    const n = this.doc.numPages
    for (let start = 2; start <= n && !this.disposed; start += SIZE_CHUNK) {
      const end = Math.min(n, start + SIZE_CHUNK - 1)
      const chunk = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, k) => pageSizeOf(this.doc, start + k)),
      )
      if (this.disposed) return
      const old = this.sourceSizes
      if (chunk.every((s, k) => sameSize(s, old[start - 1 + k]))) continue
      const next = old.slice()
      chunk.forEach((s, k) => (next[start - 1 + k] = s))
      this.applySourceSizes(next)
    }
  }

  /** Replaces the file page sizes, keeping the current page's position in the viewport. */
  private applySourceSizes(sizes: PageSize[]): void {
    const p = Math.min(this.currentPage, this.pages.length) - 1
    const oldTop = this.layout.tops[p]
    const oldContentW = contentWidth(this.layout, this.viewportW)
    this.sourceSizes = sizes
    // Pages are centred in the content, so a wider page arriving shifts every
    // page right by half the growth; follow it so the view doesn't drift.
    const dw = contentWidth(this.layout, this.viewportW) - oldContentW
    if (dw !== 0) this.scrollLeft = Math.max(0, this.scrollLeft + dw / 2)
    if (oldTop === undefined) return
    const delta = this.layout.tops[p] - oldTop
    if (delta === 0) return
    this.scrollTop += delta
    if (this.pinnedTop !== null) this.pinnedTop += delta
  }

  setViewport(width: number, height: number): void {
    const changed = width !== this.viewportW || height !== this.viewportH
    this.viewportW = width
    this.viewportH = height
    if (changed) this.viewportWaiters.splice(0).forEach((r) => r())
  }

  /**
   * Scrolls by a delta (pan gestures). The Viewer applies the new position to
   * its scroll container and echoes the clamped result back through setScroll.
   */
  scrollBy(dx: number, dy: number): void {
    this.scrollTop = Math.max(0, this.scrollTop + dy)
    this.scrollLeft = Math.max(0, this.scrollLeft + dx)
  }

  /** Records the viewer's scroll position (from scroll events). */
  setScroll(top: number, left: number): void {
    this.scrollTop = top
    this.scrollLeft = left
    if (this.pinnedTop !== null && Math.abs(top - this.pinnedTop) < 1) return
    this.pinnedTop = null
    this.currentPage = pageAt(this.layout, top + this.viewportH / 3) + 1
  }

  /**
   * Zooms to `scale` (clamped) keeping the content point under `anchor`
   * (viewport coordinates, default: viewport centre) fixed on screen.
   */
  zoomTo(scale: number, anchor?: { x: number; y: number }): void {
    const s1 = clampScale(scale)
    if (s1 === this.scale) return
    const a = anchor ?? { x: this.viewportW / 2, y: this.viewportH / 2 }
    const l1 = computeLayout(this.pageSizes, s1)
    const pos = zoomAround(
      this.layout, l1, this.scale, s1, a,
      { top: this.scrollTop, left: this.scrollLeft }, this.viewportW,
    )
    this.scale = s1
    this.setScroll(pos.top, pos.left)
  }

  fitWidth(): void {
    const maxW = Math.max(...this.pageSizes.map((p) => p.width))
    this.zoomTo(fitWidthScale(maxW, this.viewportW))
  }

  /**
   * First display: the first page fitted (see initialScale), scrolled to the
   * top and centred horizontally. Later calls do nothing.
   */
  initView(): void {
    if (this.viewInitialized) return
    this.viewInitialized = true
    const first = this.pageSizes[0]
    if (!first) return
    const restore = this.initialView
    this.initialView = null
    if (restore && restore.page <= this.pageSizes.length) {
      this.zoomTo(restore.scale)
      const p = restore.page - 1
      const l = this.layout
      const top = l.tops[p] + restore.offset * this.pageSizes[p].height * this.scale
      const left = pageLeft(l, p, this.viewportW) - (this.viewportW - l.widths[p]) / 2
      this.setScroll(Math.max(0, Math.min(top, l.totalHeight - this.viewportH)), Math.max(0, left))
      return
    }
    this.zoomTo(initialScale(first, this.viewportW, this.viewportH))
    const l = this.layout
    const left = pageLeft(l, 0, this.viewportW) - (this.viewportW - l.widths[0]) / 2
    this.setScroll(0, Math.max(0, left))
  }

  /**
   * Where initView opens the document instead of the first page (a view
   * remembered from the last time the file was closed); ignored when the
   * document no longer has that page.
   */
  initialView: DocumentView | null = null

  /** The current page, position in it and zoom; null before initView (nothing shown yet). */
  currentView(): DocumentView | null {
    if (!this.viewInitialized || this.pageSizes.length === 0) return null
    const p = Math.min(this.currentPage, this.pageSizes.length) - 1
    const height = this.pageSizes[p].height * this.scale
    return { page: p + 1, offset: (this.scrollTop - this.layout.tops[p]) / height, scale: this.scale }
  }

  /**
   * Remembers the current page and how far into it the viewport is (as a
   * fraction of the page height, so it survives a zoom change). `resized`
   * resolves when the viewport size next changes; `restore` puts the position
   * back, unless the user scrolled in the meantime.
   */
  anchorView(): ViewAnchor {
    const p = Math.max(0, this.currentPage - 1)
    const height = (this.pageSizes[p]?.height ?? 1) * this.scale
    const fraction = (this.scrollTop - (this.layout.tops[p] ?? 0)) / height
    const top0 = this.scrollTop
    const scale0 = this.scale
    const left = this.scrollLeft
    const resized = new Promise<void>((resolve) => this.viewportWaiters.push(resolve))
    const restore = () => {
      if (this.disposed) return
      // A resize may clamp the scroll position; anything else is the user moving.
      const clamped = Math.min(top0, Math.max(0, this.layout.totalHeight - this.viewportH))
      if (this.scale === scale0 && Math.abs(this.scrollTop - clamped) >= 1) return
      const h = (this.pageSizes[p]?.height ?? 1) * this.scale
      this.setScroll(Math.max(0, (this.layout.tops[p] ?? 0) + fraction * h), left)
    }
    return { resized, restore }
  }

  /**
   * Scrolls so 1-based page `page` (clamped to the document) is at the top,
   * or, with `offset`, the point `offset` px (at the current scale) below
   * the page's top edge (a link destination).
   */
  goToPage(page: number, offset = 0): void {
    const n = this.pageSizes.length
    if (n === 0) return
    const p = Math.min(n, Math.max(1, Math.round(page)))
    const l = this.layout
    const maxTop = Math.max(0, l.totalHeight - this.viewportH)
    const top = Math.min(maxTop, Math.max(0, l.tops[p - 1] + Math.max(0, offset) - PAGE_GAP))
    this.scrollTop = top
    this.currentPage = p
    this.pinnedTop = top
  }

  /** /Rotate of 0-based page `i` of the shown list (its file rotation plus any page rotation). */
  async pageRotation(i: number): Promise<number> {
    const entry = this.pages[i]
    if (!entry) return 0
    return (await this.fileRotation(entry)) + entry.rotate
  }

  /** The file page's own /Rotate of a source entry; 0 for an empty page. */
  private async fileRotation(entry: PageEntry): Promise<number> {
    return entry.kind === 'source' ? (await this.doc.getPage(entry.source + 1)).rotate : 0
  }

  canDeletePage(): boolean {
    return this.pages.length > 1
  }

  /** Page operations (one undo step each); `i` is a 0-based index into `pages`. */
  duplicatePage(i: number): void {
    if (!this.pages[i]) return
    this.commitPendingEdit()
    this.history.execute(duplicatePage(this, i))
  }

  deletePage(i: number): void {
    if (!this.pages[i]) return
    this.commitPendingEdit()
    const cmd = deletePage(this, i)
    if (cmd) this.history.execute(cmd)
  }

  /** Inserts an empty page after page `i`, with its size and rotation. */
  async insertBlankPage(i: number): Promise<void> {
    const entry = this.pages[i]
    if (!entry) return
    this.commitPendingEdit()
    let blank: { width: number; height: number; rotate: number }
    if (entry.kind === 'blank') {
      blank = { width: entry.width, height: entry.height, rotate: entry.rotate }
    } else {
      const page = await this.doc.getPage(entry.source + 1)
      const { width, height } = page.getViewport({ scale: 1, rotation: 0 })
      blank = { width, height, rotate: normalizeRotation(page.rotate + entry.rotate) }
    }
    // The list may have changed while waiting: only insert after the same page.
    if (this.pages[i] !== entry) return
    this.history.execute(insertBlankPage(this, i, blank))
  }

  /** Turns page `i` by ±90 degrees. */
  async rotatePage(i: number, delta: 90 | -90): Promise<void> {
    const entry = this.pages[i]
    if (!entry) return
    this.commitPendingEdit()
    const fileRotation = await this.fileRotation(entry)
    const box = await this.userBox(entry)
    if (this.pages[i] !== entry) return
    this.history.execute(rotatePage(this, i, delta, fileRotation, box))
  }

  /**
   * Several pages at once (the document builder), one undo step each;
   * `indices` are 0-based. Duplicates go right after the last of the pages,
   * in page order; returns the indices of the copies.
   */
  duplicatePages(indices: readonly number[]): number[] {
    this.commitPendingEdit()
    const cmd = duplicatePages(this, indices)
    if (!cmd) return []
    const n = new Set(indices.filter((i) => this.pages[i])).size
    const last = Math.max(...indices.filter((i) => this.pages[i]))
    this.history.execute(cmd)
    return Array.from({ length: n }, (_, k) => last + 1 + k)
  }

  /** Deletes the pages; false when nothing was deleted (it would leave no page). */
  deletePages(indices: readonly number[]): boolean {
    this.commitPendingEdit()
    const cmd = deletePages(this, indices)
    if (!cmd) return false
    this.history.execute(cmd)
    return true
  }

  /** Turns the pages by ±90 degrees. */
  async rotatePages(indices: readonly number[], delta: 90 | -90): Promise<void> {
    this.commitPendingEdit()
    const pages = this.pages
    const list = [...new Set(indices)].filter((i) => pages[i])
    const turns: PageTurn[] = await Promise.all(
      list.map(async (i) => ({
        i,
        fileRotation: await this.fileRotation(pages[i]),
        pageBox: await this.userBox(pages[i]),
      })),
    )
    // The list changed while waiting (undo, another operation): do nothing.
    if (this.pages !== pages) return
    const cmd = rotatePages(this, turns, delta)
    if (cmd) this.history.execute(cmd)
  }

  /** The unrotated user-space box of an entry's page (its crop box; [0 0 w h] for an empty page). */
  private async userBox(entry: PageEntry): Promise<Rect> {
    if (entry.kind === 'blank') return [0, 0, entry.width, entry.height]
    const page = await this.doc.getPage(entry.source + 1)
    const view = (page as { view?: number[] }).view
    if (view?.length === 4) return [view[0], view[1], view[2], view[3]]
    const { width, height } = page.getViewport({ scale: 1, rotation: 0 })
    return [0, 0, width, height]
  }

  /**
   * The page list as a save plan, or null when it is the file's own order
   * (nothing to write). Taken from the page list at the call.
   */
  pagePlan(): Promise<PageSpec[]> | null {
    const pages = this.pages
    const doc = this.doc
    if (isIdentity(pages, doc.numPages)) return null
    return (async () => {
      const rotations: number[] = []
      const sources = new Set(pages.flatMap((p) => (p.kind === 'source' ? [p.source] : [])))
      await Promise.all([...sources].map(async (i) => (rotations[i] = (await doc.getPage(i + 1)).rotate)))
      return pagePlan(pages, rotations)
    })()
  }

  /**
   * Re-opens the document from `path` in place (after a save that changed
   * pages): loadSaved, then applyReload.
   */
  async reload(): Promise<void> {
    this.applyReload(await this.loadSaved())
  }

  /**
   * Reads the file at `path` (pdf.js document and annotations) without
   * touching the session; the session keeps working meanwhile.
   */
  async loadSaved(): Promise<ReloadedDocument> {
    const [bytes, read] = await Promise.all([openPdf(this.path), readManaged(this.path)])
    const doc = await loadPdf(bytes)
    try {
      return { doc, annotations: await withFreeTextLines(doc, read) }
    } catch (e) {
      await doc.destroy()
      throw e
    }
  }

  /**
   * Switches the session to a document from loadSaved, in one synchronous
   * step: the new pdf.js document, the file's page order, its annotations
   * and an empty history. The shown pages keep their sizes, so the view
   * stays put.
   */
  applyReload({ doc, annotations }: ReloadedDocument): void {
    if (this.disposed) {
      void doc.destroy()
      return
    }
    const path = this.path
    const old = this.doc
    const shown = this.pageSizes
    renderCache.evictPrefix(`${this.id}:`)
    thumbnailCache.evictPrefix(`${this.id}:`)
    this.#doc = doc
    this.suppress(annotations.flatMap((a) => (a.sourceRef ? [a.sourceRef] : [])))
    this.store.load(annotations)
    this.history.reset()
    // The saved file has the pages as they were shown: same sizes.
    this.sourceSizes = Array.from({ length: doc.numPages }, (_, i) => shown[i] ?? shown[0])
    this.pages = identityPages(doc.numPages)
    void old.destroy()
    this.loadRemainingSizes().catch((e: unknown) => {
      if (!this.disposed) console.error(`Failed to read page sizes of ${path}`, e)
    })
  }

  dispose(): Promise<void> {
    this.disposed = true
    renderCache.evictPrefix(`${this.id}:`)
    thumbnailCache.evictPrefix(`${this.id}:`)
    return this.doc.destroy()
  }
}
