import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  dragCb: null as null | ((e: { payload: unknown }) => void),
  eventCb: null as null | ((e: { payload: string[] }) => void),
  launch: [] as string[],
  picked: null as string | string[] | null,
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: (e: { payload: unknown }) => void) => {
      h.dragCb = cb
      return () => {}
    },
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_n: string, cb: (e: { payload: string[] }) => void) => {
    h.eventCb = cb
    return () => {}
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => h.picked }))
vi.mock('../../src/core/ipc/api', async (orig) => ({
  ...(await orig<typeof import('../../src/core/ipc/api')>()),
  getLaunchFiles: async () => h.launch,
}))

import { toasts } from '../../src/ui/toasts.svelte'
import { initFileOpening, openFiles, openRecentFile, pdfPaths, pickAndOpen, setDropTarget } from '../../src/app/fileOpening'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('fileOpening', () => {
  beforeEach(() => {
    h.dragCb = h.eventCb = null
    h.launch = []
    h.picked = null
  })

  it('pdfPaths keeps only .pdf files, case-insensitively', () => {
    expect(pdfPaths(['a.pdf', 'B.PDF', 'c.txt', 'd.pdf.exe', 'e.Pdf'])).toEqual([
      'a.pdf',
      'B.PDF',
      'e.Pdf',
    ])
  })

  it('opens only PDFs from drag-drop, open-files event and launch args', async () => {
    h.launch = ['l.PDF', 'l.png']
    const open = vi.fn(async () => {})
    const dispose = initFileOpening(open)
    await flush()
    h.dragCb!({ payload: { type: 'drop', paths: ['d.pdf', 'x.doc'] } })
    h.dragCb!({ payload: { type: 'over' } })
    h.eventCb!({ payload: ['e.pdf', 'y.txt'] })
    await flush()
    expect(open.mock.calls.map((c) => c[0]).sort()).toEqual(['d.pdf', 'e.pdf', 'l.PDF'])
    dispose()
  })

  it('pickAndOpen reuses the handler given to initFileOpening', async () => {
    const open = vi.fn(async () => {})
    const dispose = initFileOpening(open)
    h.picked = ['p1.pdf', 'p2.pdf']
    await pickAndOpen()
    expect(open.mock.calls.map((c) => c[0])).toEqual(['p1.pdf', 'p2.pdf'])
    h.picked = null
    await pickAndOpen()
    expect(open).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('one failing file does not stop the others and is reported with a toast', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    const open = vi.fn(async (p: string) => {
      if (p.endsWith('bad.pdf')) throw { code: 'InvalidPdf', message: 'x' }
      if (p.endsWith('odd.pdf')) throw new Error('weird')
    })
    const dispose = initFileOpening(open)
    h.picked = ['C:/docs/bad.pdf', 'C:/docs/odd.pdf', 'good.pdf']
    await pickAndOpen()
    expect(open.mock.calls.map((c) => c[0])).toEqual(h.picked)
    expect(show).toHaveBeenCalledWith('This file could not be opened as a PDF', 'error')
    expect(show).toHaveBeenCalledWith('Could not open odd.pdf', 'error')
    dispose()
    err.mockRestore()
    show.mockRestore()
  })

  it('a missing launch file shows the not-found toast and the other launch files still open', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    h.launch = ['gone.pdf', 'here.pdf']
    const open = vi.fn(async (p: string) => {
      if (p === 'gone.pdf') throw { code: 'NotFound', message: 'gone.pdf: not found' }
    })
    const dispose = initFileOpening(open)
    await flush()
    expect(open.mock.calls.map((c) => c[0])).toEqual(['gone.pdf', 'here.pdf'])
    expect(show).toHaveBeenCalledWith('File not found', 'error')
    dispose()
    err.mockRestore()
    show.mockRestore()
  })

  it('while a drop target is set, dropped PDFs go to it instead of opening', async () => {
    const open = vi.fn(async () => {})
    const target = vi.fn()
    const dispose = initFileOpening(open)
    await flush()
    const release = setDropTarget(target)
    h.dragCb!({ payload: { type: 'drop', paths: ['a.pdf', 'x.doc', 'B.PDF'] } })
    h.dragCb!({ payload: { type: 'drop', paths: ['y.txt'] } })
    await flush()
    expect(target.mock.calls).toEqual([[['a.pdf', 'B.PDF']]])
    expect(open).not.toHaveBeenCalled()
    release()
    h.dragCb!({ payload: { type: 'drop', paths: ['c.pdf'] } })
    await flush()
    expect(open.mock.calls.map((c) => c[0])).toEqual(['c.pdf'])
    dispose()
  })

  it('releasing a replaced drop target keeps the newer one', async () => {
    const dispose = initFileOpening(vi.fn(async () => {}))
    await flush()
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = setDropTarget(first)
    const releaseSecond = setDropTarget(second)
    releaseFirst()
    h.dragCb!({ payload: { type: 'drop', paths: ['a.pdf'] } })
    expect(second).toHaveBeenCalledWith(['a.pdf'])
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
    dispose()
  })

  it('openFiles opens through the registered handler', async () => {
    const open = vi.fn(async () => {})
    const dispose = initFileOpening(open)
    await openFiles(['m.pdf'])
    expect(open).toHaveBeenCalledWith('m.pdf')
    dispose()
  })
})

describe('openRecentFile', () => {
  it('opens through the registered handler and keeps the entry', async () => {
    const open = vi.fn(async () => {})
    const forget = vi.fn()
    const dispose = initFileOpening(open)
    await openRecentFile('C:\\a.pdf', forget)
    expect(open).toHaveBeenCalledWith('C:\\a.pdf')
    expect(forget).not.toHaveBeenCalled()
    dispose()
  })

  it('a missing file is dropped from the list with a warning toast', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    const forget = vi.fn()
    const dispose = initFileOpening(async () => {
      throw { code: 'NotFound', message: 'not found' }
    })
    await openRecentFile('C:\\docs\\gone.pdf', forget)
    expect(forget).toHaveBeenCalledWith('C:\\docs\\gone.pdf')
    expect(show).toHaveBeenCalledWith('gone.pdf was not found and was removed from recent files', 'warning')
    dispose()
    err.mockRestore()
    show.mockRestore()
  })

  it('any other failure is reported and the entry stays', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    const forget = vi.fn()
    const dispose = initFileOpening(async () => {
      throw { code: 'Locked', message: 'locked' }
    })
    await openRecentFile('C:\\a.pdf', forget)
    expect(forget).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('The file is locked by another program', 'error')
    dispose()
    err.mockRestore()
    show.mockRestore()
  })
})
