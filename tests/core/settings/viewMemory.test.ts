import { describe, expect, it } from 'vitest'
import { MAX_REMEMBERED_VIEWS, findView, readViews, withView, type RememberedView } from '../../../src/core/settings/viewMemory'

const view = (path: string, page = 1): RememberedView => ({ path, page, offset: 0.1, scale: 1.5 })

describe('viewMemory', () => {
  it('readViews keeps valid entries in order', () => {
    const list = [view('C:\\a.pdf', 3), view('C:\\b.pdf', 1)]
    expect(readViews(list)).toEqual(list)
  })

  it('readViews drops malformed entries and anything that is not a list', () => {
    for (const stored of [undefined, null, 1, 'x', {}]) expect(readViews(stored)).toEqual([])
    const bad = [
      null, 'x', {}, { ...view(''), path: '' }, { ...view('C:\\a.pdf'), page: 0 }, { ...view('C:\\a.pdf'), page: 1.5 },
      { ...view('C:\\a.pdf'), offset: Number.NaN }, { ...view('C:\\a.pdf'), scale: 0 }, { ...view('C:\\a.pdf'), scale: '1' },
    ]
    expect(readViews([...bad, view('C:\\ok.pdf')])).toEqual([view('C:\\ok.pdf')])
  })

  it('readViews drops extra fields, keeps the first of duplicate paths and caps the list', () => {
    expect(readViews([{ ...view('C:\\a.pdf', 2), extra: 1 }])).toEqual([view('C:\\a.pdf', 2)])
    expect(readViews([view('C:\\A.pdf', 2), view('c:\\a.PDF', 5)])).toEqual([view('C:\\A.pdf', 2)])
    const many = Array.from({ length: MAX_REMEMBERED_VIEWS + 10 }, (_, i) => view(`C:\\${i}.pdf`))
    expect(readViews(many)).toHaveLength(MAX_REMEMBERED_VIEWS)
  })

  it('withView puts the view first and replaces the same file case-insensitively', () => {
    const list = [view('C:\\a.pdf', 1), view('C:\\b.pdf', 2)]
    expect(withView(list, view('c:\\B.PDF', 7))).toEqual([view('c:\\B.PDF', 7), view('C:\\a.pdf', 1)])
    expect(list).toHaveLength(2)
  })

  it('withView drops the least recent file beyond the cap', () => {
    let list: RememberedView[] = []
    for (let i = 0; i < MAX_REMEMBERED_VIEWS + 1; i++) list = withView(list, view(`C:\\${i}.pdf`))
    expect(list).toHaveLength(MAX_REMEMBERED_VIEWS)
    expect(list[0].path).toBe(`C:\\${MAX_REMEMBERED_VIEWS}.pdf`)
    expect(findView(list, 'C:\\0.pdf')).toBeUndefined()
    expect(findView(list, 'c:\\1.PDF')?.path).toBe('C:\\1.pdf')
  })
})
