/** How a document was last shown: enough to reopen it at the same place. */
export interface DocumentView {
  /** 1-based page the viewer was on (the status bar's page). */
  page: number
  /**
   * How far the top of the viewport was below that page's top edge, as a
   * fraction of the page height (so it does not depend on the scale; it may
   * be slightly negative when the viewport top sits in the gap above it).
   */
  offset: number
  scale: number
}

/** A file's last view, saved under `views` in settings.json. */
export interface RememberedView extends DocumentView {
  path: string
}

/** How many files keep their view; the least recently closed ones drop out. */
export const MAX_REMEMBERED_VIEWS = 50

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function readView(v: unknown): RememberedView | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.path !== 'string' || o.path === '') return null
  if (!Number.isInteger(o.page) || (o.page as number) < 1) return null
  if (!isNum(o.offset) || !isNum(o.scale) || o.scale <= 0) return null
  return { path: o.path, page: o.page as number, offset: o.offset, scale: o.scale }
}

const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The stored list (most recent first), without malformed or duplicate entries, at most MAX_REMEMBERED_VIEWS. */
export function readViews(stored: unknown): RememberedView[] {
  if (!Array.isArray(stored)) return []
  const out: RememberedView[] = []
  for (const v of stored) {
    const view = readView(v)
    if (view && !out.some((o) => sameFile(o.path, view.path))) out.push(view)
    if (out.length === MAX_REMEMBERED_VIEWS) break
  }
  return out
}

/** The list with `view` first, replacing an older entry for the same file (paths compare case-insensitively, like Windows). */
export function withView(list: RememberedView[], view: RememberedView): RememberedView[] {
  return [view, ...list.filter((v) => !sameFile(v.path, view.path))].slice(0, MAX_REMEMBERED_VIEWS)
}

/** The remembered view of the file at `path`, if any. */
export function findView(list: RememberedView[], path: string): RememberedView | undefined {
  return list.find((v) => sameFile(v.path, path))
}
