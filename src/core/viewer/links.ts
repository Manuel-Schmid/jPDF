import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageEntry } from '../session/pages'
import type { Point, Rect } from '../session/model'

/**
 * Where a link goes: a web address (opened in the browser), a destination
 * in this document (a name or an explicit destination array, see
 * resolveDestination), or a page-turning named action.
 */
export type LinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'dest'; dest: string | unknown[] }
  | { kind: 'named'; action: 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage' }

/** A link annotation of a file page: its rect in PDF user space and its target. */
export interface PageLink {
  rect: Rect
  target: LinkTarget
}

const NAMED = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage'])

/**
 * The links among pdf.js annotation data (getAnnotations). pdf.js sets `url`
 * only for a valid absolute URL with a safe scheme (http, https, mailto …;
 * never javascript:), so `unsafeUrl` is ignored. Links without a usable
 * target (e.g. JavaScript actions, launch actions) are skipped.
 */
export function linksFromAnnotations(annotations: readonly Record<string, unknown>[]): PageLink[] {
  const out: PageLink[] = []
  for (const a of annotations) {
    if (a.subtype !== 'Link' || !Array.isArray(a.rect) || a.rect.length !== 4) continue
    const [x1, y1, x2, y2] = a.rect as number[]
    const rect: Rect = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
    if (!(rect[2] > rect[0] && rect[3] > rect[1])) continue
    let target: LinkTarget | null = null
    if (typeof a.url === 'string' && a.url !== '') target = { kind: 'url', url: a.url }
    else if (typeof a.dest === 'string' || Array.isArray(a.dest)) target = { kind: 'dest', dest: a.dest }
    else if (typeof a.action === 'string' && NAMED.has(a.action))
      target = { kind: 'named', action: a.action as 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage' }
    if (target) out.push({ rect, target })
  }
  return out
}

/** The topmost link at `p` (later annotations lie on top), its rect grown by `tolerance` (pt). */
export function linkAt(links: readonly PageLink[], p: Point, tolerance = 0): PageLink | null {
  for (let i = links.length - 1; i >= 0; i--) {
    const [x1, y1, x2, y2] = links[i].rect
    if (p[0] >= x1 - tolerance && p[0] <= x2 + tolerance && p[1] >= y1 - tolerance && p[1] <= y2 + tolerance) {
      return links[i]
    }
  }
  return null
}

const cache = new WeakMap<PDFPageProxy, Promise<PageLink[]>>()

/**
 * The links of a file page, read once per page (failed reads are retried
 * next time). Only the link rects and targets are kept: no pdf.js
 * annotation layer.
 */
export function linksOf(page: PDFPageProxy): Promise<PageLink[]> {
  let p = cache.get(page)
  if (!p) {
    p = page.getAnnotations({ intent: 'display' }).then(linksFromAnnotations)
    cache.set(page, p)
    p.catch(() => cache.delete(page))
  }
  return p
}

/** The link at a point of a shown page: the link, none (null), or undefined while not (yet) known. */
export type LinkLookup = (page: number, p: Point, tolerance: number) => PageLink | null | undefined

/**
 * A LinkLookup for the document's shown pages (`pages()[i]` is page i). A
 * page's links load on its first lookup (the page is on screen then), which
 * answers undefined until they are there. Empty pages have no links.
 */
export function createLinkLookup(
  pages: () => readonly PageEntry[] | undefined,
  getPage: (source: number) => Promise<PDFPageProxy> | undefined,
): LinkLookup {
  const loaded = new WeakMap<PageEntry, PageLink[] | 'loading'>()
  return (page, p, tolerance) => {
    const entry = pages()?.[page]
    if (!entry) return undefined
    if (entry.kind === 'blank') return null
    const links = loaded.get(entry)
    if (links === undefined) {
      const pending = getPage(entry.source)
      if (!pending) return undefined
      loaded.set(entry, 'loading')
      pending
        .then(linksOf)
        .then((l) => loaded.set(entry, l))
        // Unreadable annotations: a page without links.
        .catch(() => loaded.set(entry, []))
      return undefined
    }
    if (links === 'loading') return undefined
    return linkAt(links, p, tolerance)
  }
}

/** Where a destination points: a 0-based file page and, if given, a point on it (PDF user space). */
export interface ResolvedDest {
  page: number
  left: number | null
  top: number | null
}

/** What resolveDestination needs from the document (PdfDoc has both). */
export interface DestinationSource {
  getDestination(id: string): Promise<unknown[] | null>
  getPageIndex(ref: { num: number; gen: number }): Promise<number>
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Resolves a named or explicit destination ([page, /Kind, ...args], PDF
 * 32000 12.3.2.2) to its page and the point the view should start at:
 * XYZ gives left and top, FitH/FitBH a top, FitR its top-left corner; Fit,
 * FitB, FitV and FitBV only the page. The page is a reference or, in some
 * files, a 0-based page number. Null when it cannot be resolved.
 */
export async function resolveDestination(doc: DestinationSource, dest: string | unknown[]): Promise<ResolvedDest | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const [ref, kind, ...args] = explicit
  let page: number
  if (typeof ref === 'number' && Number.isInteger(ref)) page = ref
  else if (typeof ref === 'object' && ref !== null && 'num' in ref && 'gen' in ref) {
    page = await doc.getPageIndex(ref as { num: number; gen: number })
  } else return null
  const name = typeof kind === 'object' && kind !== null && 'name' in kind ? String(kind.name) : ''
  switch (name) {
    case 'XYZ':
      return { page, left: num(args[0]), top: num(args[1]) }
    case 'FitH':
    case 'FitBH':
      return { page, left: null, top: num(args[0]) }
    case 'FitR':
      return { page, left: num(args[0]), top: num(args[3]) }
    default:
      return { page, left: null, top: null }
  }
}
