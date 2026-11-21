/** A recently opened file, saved under `recent` in settings.json (paths only: the start page stays instant). */
export interface RecentFile {
  path: string
  /** When it was last opened (ms since the epoch). */
  openedAt: number
}

/** How many files the start page lists; older ones drop out. */
export const MAX_RECENT_FILES = 10

const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function readRecentFile(v: unknown): RecentFile | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.path !== 'string' || o.path === '') return null
  if (typeof o.openedAt !== 'number' || !Number.isFinite(o.openedAt)) return null
  return { path: o.path, openedAt: o.openedAt }
}

/** The stored list (most recent first), without malformed or duplicate entries, at most MAX_RECENT_FILES. */
export function readRecentFiles(stored: unknown): RecentFile[] {
  if (!Array.isArray(stored)) return []
  const out: RecentFile[] = []
  for (const v of stored) {
    const f = readRecentFile(v)
    if (f && !out.some((o) => sameFile(o.path, f.path))) out.push(f)
    if (out.length === MAX_RECENT_FILES) break
  }
  return out
}

/** The list with `path` first (paths compare case-insensitively, like Windows). */
export function withRecentFile(list: RecentFile[], path: string, openedAt: number): RecentFile[] {
  return [{ path, openedAt }, ...withoutRecentFile(list, path)].slice(0, MAX_RECENT_FILES)
}

/** The list without `path`. */
export function withoutRecentFile(list: RecentFile[], path: string): RecentFile[] {
  return list.filter((f) => !sameFile(f.path, path))
}

/** The folder part of a path (shown dimmed next to the file name); empty for a bare name. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i < 0 ? '' : path.slice(0, i)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "Today", "Yesterday", or the date, for when a recent file was last opened. */
export function openedLabel(openedAt: number, now: number, locale?: string): string {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((startOfDay(now) - startOfDay(openedAt)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(openedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}
