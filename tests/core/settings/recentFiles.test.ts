import { describe, expect, it } from 'vitest'
import {
  MAX_RECENT_FILES, folderOf, openedLabel, readRecentFiles, withRecentFile, withoutRecentFile, type RecentFile,
} from '../../../src/core/settings/recentFiles'

const f = (path: string, openedAt = 1): RecentFile => ({ path, openedAt })

describe('recentFiles', () => {
  it('readRecentFiles keeps valid entries in order and drops extra fields', () => {
    expect(readRecentFiles([f('C:\\a.pdf', 2), { ...f('C:\\b.pdf'), x: 1 }])).toEqual([f('C:\\a.pdf', 2), f('C:\\b.pdf')])
  })

  it('readRecentFiles drops malformed entries, duplicates and anything not a list; caps the list', () => {
    for (const stored of [undefined, null, 1, 'x', {}]) expect(readRecentFiles(stored)).toEqual([])
    const bad = [null, 'C:\\a.pdf', {}, f(''), { path: 'C:\\a.pdf' }, { path: 'C:\\a.pdf', openedAt: Number.NaN }, { path: 1, openedAt: 1 }]
    expect(readRecentFiles([...bad, f('C:\\ok.pdf'), f('c:\\OK.pdf', 9)])).toEqual([f('C:\\ok.pdf')])
    const many = Array.from({ length: MAX_RECENT_FILES + 5 }, (_, i) => f(`C:\\${i}.pdf`))
    expect(readRecentFiles(many)).toHaveLength(MAX_RECENT_FILES)
  })

  it('withRecentFile puts the file first, replaces it case-insensitively and caps the list', () => {
    const list = [f('C:\\a.pdf'), f('C:\\b.pdf')]
    expect(withRecentFile(list, 'c:\\B.PDF', 5)).toEqual([f('c:\\B.PDF', 5), f('C:\\a.pdf')])
    expect(list).toHaveLength(2)
    let full: RecentFile[] = []
    for (let i = 0; i <= MAX_RECENT_FILES; i++) full = withRecentFile(full, `C:\\${i}.pdf`, i)
    expect(full).toHaveLength(MAX_RECENT_FILES)
    expect(full[0].path).toBe(`C:\\${MAX_RECENT_FILES}.pdf`)
    expect(full.some((x) => x.path === 'C:\\0.pdf')).toBe(false)
  })

  it('withoutRecentFile drops the file case-insensitively', () => {
    expect(withoutRecentFile([f('C:\\a.pdf'), f('C:\\b.pdf')], 'c:\\A.pdf')).toEqual([f('C:\\b.pdf')])
  })

  it('folderOf gives the folder of Windows and forward-slash paths', () => {
    expect(folderOf('C:\\Uni\\Lectures\\week1.pdf')).toBe('C:\\Uni\\Lectures')
    expect(folderOf('C:/docs/a.pdf')).toBe('C:/docs')
    expect(folderOf('a.pdf')).toBe('')
  })

  it('openedLabel says Today, Yesterday, or the date', () => {
    const now = new Date(2026, 10, 21, 9, 0).getTime()
    expect(openedLabel(new Date(2026, 10, 21, 0, 5).getTime(), now)).toBe('Today')
    expect(openedLabel(new Date(2026, 10, 20, 23, 59).getTime(), now)).toBe('Yesterday')
    expect(openedLabel(new Date(2026, 10, 1).getTime(), now, 'en-GB')).toBe('1 Nov 2026')
  })
})
