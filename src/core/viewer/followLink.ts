import { confirm, message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '../ipc/api'
import type { PageEntry } from '../session/pages'
import type { PageLink } from './links'
import { resolveDestination } from './links'
import { sourceViewport } from './pageSource'
import type { PdfDoc } from './pdfEngine'

/** What following a link needs from the session. */
export interface LinkSession {
  doc: PdfDoc
  pages: readonly PageEntry[]
  scale: number
  goToPage(page: number, offset?: number): void
}

/** Side effects outside the viewer, replaceable in tests. */
export interface LinkEffects {
  /** Asks before a web link opens, showing its address; true = open it. */
  confirmUrl(url: string): Promise<boolean>
  openUrl(url: string): Promise<void>
  /** Reports a link that could not be opened. */
  report(text: string): void
}

export const defaultLinkEffects: LinkEffects = {
  confirmUrl: (url) =>
    confirm(`Open this link in your browser?\n\n${url}`, { title: 'Open link', kind: 'info', okLabel: 'Open', cancelLabel: 'Cancel' }),
  openUrl,
  report: (text) => void message(text, { title: 'Open link', kind: 'error' }).catch(() => {}),
}

/** The shown page (0-based) of 0-based file page `source`: its first copy; -1 when deleted. */
export function shownPageOf(pages: readonly PageEntry[], source: number): number {
  return pages.findIndex((e) => e.kind === 'source' && e.source === source)
}

/**
 * Follows `link`, clicked on shown page `from` (0-based): a web link opens
 * in the browser once confirmed (a stray click must not launch it); a
 * destination in the document scrolls to its page and, if it names one, to
 * its point; page-turning actions go to the next, previous, first or last
 * page. A destination on a deleted page does nothing.
 */
export async function followLink(
  session: LinkSession,
  link: PageLink,
  from: number,
  effects: LinkEffects = defaultLinkEffects,
): Promise<void> {
  const t = link.target
  if (t.kind === 'url') {
    if (!(await effects.confirmUrl(t.url))) return
    try {
      await effects.openUrl(t.url)
    } catch (e) {
      console.error('Failed to open link', e)
      effects.report(`Could not open ${t.url}`)
    }
    return
  }
  if (t.kind === 'named') {
    const target = { NextPage: from + 2, PrevPage: from, FirstPage: 1, LastPage: session.pages.length }[t.action]
    if (target >= 1 && target <= session.pages.length) session.goToPage(target)
    return
  }
  const doc = session.doc
  let dest
  try {
    dest = await resolveDestination(doc, t.dest)
  } catch (e) {
    console.error('Failed to resolve link destination', e)
    return
  }
  if (!dest || doc.destroyed) return
  const i = shownPageOf(session.pages, dest.page)
  const entry = session.pages[i]
  if (!entry || entry.kind !== 'source') return
  if (dest.left === null && dest.top === null) return session.goToPage(i + 1)
  // The point on screen, below the page's top edge (rotation included).
  const vp = sourceViewport(await doc.getPage(entry.source + 1), entry, session.scale)
  const [x0, , , y1] = vp.viewBox
  const [, y] = vp.convertToViewportPoint(dest.left ?? x0, dest.top ?? y1)
  session.goToPage(i + 1, Math.min(Math.max(0, y), vp.height))
}
