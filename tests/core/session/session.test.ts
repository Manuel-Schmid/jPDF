import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ doc: null as unknown, annotations: [] as unknown[] | Error }))
vi.mock('../../../src/core/ipc/api', () => ({
  openPdf: vi.fn(async () => new ArrayBuffer(8)),
  readAnnotations: vi.fn(async () => {
    if (mocks.annotations instanceof Error) throw mocks.annotations
    return mocks.annotations
  }),
}))
vi.mock('../../../src/core/viewer/pdfEngine', () => ({ loadPdf: async () => mocks.doc }))

/** Fake doc; getPage(i) resolves with sizes[i-1], or waits on `gate` for pages > 1. */
function fakeDoc(sizes: { width: number; height: number }[], gate?: Promise<void>) {
  return {
    numPages: sizes.length,
    destroyed: false,
    getPage: vi.fn(async (i: number) => {
      if (i > 1 && gate) await gate
      return { getViewport: () => sizes[i - 1] }
    }),
    suppressAnnotations: vi.fn(),
    destroy: vi.fn(async () => {}),
  }
}
const uniform = Array.from({ length: 4 }, () => ({ width: 600, height: 800 }))

import { DocumentSession } from '../../../src/core/session/session.svelte'
import { toasts } from '../../../src/ui/toasts.svelte'
import { renderCache } from '../../../src/core/viewer/renderCache'
import { PAGE_GAP, pageLeft } from '../../../src/core/viewer/layout'

// 4 pages of 600x800 pt. At scale 1: tops 16, 832, 1648, 2464; totalHeight 3280.
let s: DocumentSession
beforeEach(async () => {
  mocks.annotations = []
  mocks.doc = fakeDoc(uniform)
  s = await DocumentSession.open('C:/docs/a.pdf')
  await s.pageSizesLoaded
  s.setViewport(1000, 500)
})

describe('DocumentSession view state', () => {
  it('lays pages out at the current scale', () => {
    expect(s.layout.tops).toEqual([16, 832, 1648, 2464])
    s.zoomTo(2)
    expect(s.layout.tops[1]).toBe(16 + 1600 + 16)
  })

  it('fitWidth fits the widest page into the viewport', () => {
    s.fitWidth()
    expect(s.scale).toBeCloseTo((1000 - 2 * PAGE_GAP) / 600)
  })

  it('scrollBy moves the scroll position and never goes negative', () => {
    s.setScroll(100, 50)
    s.scrollBy(20, -30)
    expect([s.scrollTop, s.scrollLeft]).toEqual([70, 70])
    s.scrollBy(-500, -500)
    expect([s.scrollTop, s.scrollLeft]).toEqual([0, 0])
  })

  it('initView fits a portrait first page whole, at the top, once', () => {
    s.initView()
    expect(s.scale).toBeCloseTo((500 - 2 * PAGE_GAP) / 800)
    expect(s.scrollTop).toBe(0)
    expect(s.scrollLeft).toBe(0)
    s.zoomTo(1)
    s.initView()
    expect(s.scale).toBe(1)
  })

  it('currentView is null before initView, then gives the page, the fraction into it and the scale', () => {
    expect(s.currentView()).toBeNull()
    s.initView()
    s.zoomTo(2)
    // Page 3 at scale 2: top 16 + 2 * (1600 + 16) = 3248, height 1600.
    s.setScroll(3248 + 400, 0)
    expect(s.currentView()).toEqual({ page: 3, offset: 0.25, scale: 2 })
  })

  it('initView restores an initialView: same scale and position in the page, page centred', () => {
    s.initialView = { page: 3, offset: 0.25, scale: 2 }
    s.initView()
    expect(s.scale).toBe(2)
    expect(s.scrollTop).toBe(3248 + 400)
    expect(s.currentPage).toBe(3)
    const l = s.layout
    expect(s.scrollLeft).toBe(Math.max(0, pageLeft(l, 2, 1000) - (1000 - l.widths[2]) / 2))
    expect(s.currentView()).toEqual({ page: 3, offset: 0.25, scale: 2 })
  })

  it('initView ignores an initialView past the last page (the file changed) and fits the first page', () => {
    s.initialView = { page: 9, offset: 0, scale: 2 }
    s.initView()
    expect(s.scale).toBeCloseTo((500 - 2 * PAGE_GAP) / 800)
    expect(s.scrollTop).toBe(0)
  })

  it('initView clamps a restored position to the end of the document', () => {
    s.initialView = { page: 4, offset: 0.9, scale: 1 }
    s.initView()
    expect(s.scrollTop).toBe(s.layout.totalHeight - 500)
  })

  it('initView fits a landscape first page to the width', async () => {
    mocks.doc = fakeDoc(Array.from({ length: 2 }, () => ({ width: 800, height: 600 })))
    const session = await DocumentSession.open('C:/docs/wide.pdf')
    await session.pageSizesLoaded
    session.setViewport(1000, 500)
    session.initView()
    expect(session.scale).toBeCloseTo((1000 - 2 * PAGE_GAP) / 800)
  })

  it('zoomTo clamps the scale and keeps the anchor point fixed', () => {
    s.setScroll(900, 0) // y=900+250=1150 lies on page 2, 318 pt below its top
    s.zoomTo(2, { x: 500, y: 250 })
    expect(s.scale).toBe(2)
    expect(s.scrollTop).toBe(1632 + 318 * 2 - 250)
    s.zoomTo(100)
    expect(s.scale).toBe(8)
    s.zoomTo(0.001)
    expect(s.scale).toBe(0.1)
  })

  it('zoomTo defaults the anchor to the viewport centre', () => {
    s.setScroll(900, 0)
    s.zoomTo(2)
    expect(s.scrollTop).toBe(1632 + 318 * 2 - 250)
  })

  it('setScroll tracks currentPage at a third of the viewport', () => {
    expect(s.currentPage).toBe(1)
    s.setScroll(832 - 166, 0) // 666 + 166.7 = 832.7, past page 2's top
    expect(s.currentPage).toBe(2)
    s.setScroll(500, 0)
    expect(s.currentPage).toBe(1)
  })

  it('goToPage scrolls to the page top and sets currentPage', () => {
    s.goToPage(2)
    expect(s.scrollTop).toBe(832 - PAGE_GAP)
    expect(s.currentPage).toBe(2)
  })

  it('goToPage clamps to the last scroll position but still reports the requested page', () => {
    s.setViewport(1000, 1200)
    s.goToPage(4)
    expect(s.scrollTop).toBe(3280 - 1200)
    expect(s.currentPage).toBe(4)
    // The scroll event that echoes the programmatic scroll keeps the page.
    s.setScroll(3280 - 1200, 0)
    expect(s.currentPage).toBe(4)
    // A real user scroll recomputes it.
    s.setScroll(100, 0)
    expect(s.currentPage).toBe(1)
  })

  it('goToPage with an offset scrolls to that point below the page top (link destinations)', () => {
    s.goToPage(2, 100)
    expect(s.scrollTop).toBe(832 + 100 - PAGE_GAP)
    expect(s.currentPage).toBe(2)
  })

  it('goToPage clamps out-of-range page numbers', () => {
    s.goToPage(0)
    expect(s.currentPage).toBe(1)
    s.goToPage(99)
    expect(s.currentPage).toBe(4)
  })

  it('dispose evicts the session from the render cache', async () => {
    const spy = vi.spyOn(renderCache, 'evictPrefix')
    await s.dispose()
    expect(spy).toHaveBeenCalledWith(`${s.id}:`)
  })
})

describe('DocumentSession lazy page sizes', () => {
  const mixed = [
    { width: 600, height: 800 },
    { width: 600, height: 1000 },
    { width: 800, height: 600 },
    { width: 600, height: 800 },
  ]

  it('open resolves after page 1 only, then fills real sizes in the background', async () => {
    let release!: () => void
    const doc = fakeDoc(mixed, new Promise<void>((r) => (release = r)))
    mocks.doc = doc
    const session = await DocumentSession.open('C:/docs/b.pdf')
    expect(doc.getPage.mock.calls.map((c) => c[0])).toEqual([1])
    expect(session.pageSizes).toEqual(Array.from({ length: 4 }, () => mixed[0]))
    release()
    await session.pageSizesLoaded
    expect(session.pageSizes).toEqual(mixed)
    expect(session.layout.tops).toEqual([16, 832, 1848, 2464])
  })

  it('keeps the current page anchored when sizes above it change', async () => {
    let release!: () => void
    mocks.doc = fakeDoc(mixed, new Promise<void>((r) => (release = r)))
    const session = await DocumentSession.open('C:/docs/c.pdf')
    session.setViewport(1000, 500)
    session.setScroll(1648 + 100, 0) // page 3, 100 px below its top
    expect(session.currentPage).toBe(3)
    release()
    await session.pageSizesLoaded
    expect(session.scrollTop).toBe(1848 + 100)
    expect(session.currentPage).toBe(3)
  })

  it('keeps the first page centred when a wider page loads after initView', async () => {
    let release!: () => void
    const sizes = [{ width: 600, height: 800 }, { width: 2400, height: 800 }]
    mocks.doc = fakeDoc(sizes, new Promise<void>((r) => (release = r)))
    const session = await DocumentSession.open('C:/docs/e.pdf')
    session.setViewport(1000, 500)
    session.initView()
    const pageCentre = () =>
      session.layout.widths[0] / 2 + pageLeft(session.layout, 0, 1000) - session.scrollLeft
    expect(pageCentre()).toBeCloseTo(500)
    release()
    await session.pageSizesLoaded
    expect(session.layout.maxWidth + 2 * PAGE_GAP).toBeGreaterThan(1000)
    expect(pageCentre()).toBeCloseTo(500)
  })

  it('stops filling once disposed', async () => {
    let release!: () => void
    mocks.doc = fakeDoc(mixed, new Promise<void>((r) => (release = r)))
    const session = await DocumentSession.open('C:/docs/d.pdf')
    await session.dispose()
    release()
    await session.pageSizesLoaded
    expect(session.pageSizes).toEqual(Array.from({ length: 4 }, () => mixed[0]))
  })
})

describe('DocumentSession.open annotations', () => {
  const ink = (id: string, sourceRef: string | null) => ({
    kind: 'ink', id, page: 0, sourceRef, modifiedAt: '2026-11-18T10:00:00Z', author: 'JuliePDF',
    strokes: [[[0, 0], [10, 10]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
  })

  it('loads the file annotations into the store, clean', async () => {
    mocks.annotations = [ink('a', '10R'), ink('b', '12R')]
    mocks.doc = fakeDoc(uniform)
    const session = await DocumentSession.open('C:/docs/e.pdf')
    expect(session.store.all().map((a) => a.id)).toEqual(['a', 'b'])
    expect(session.dirty).toBe(false)
    expect(session.store.changedSince()).toEqual([])
  })

  it('suppresses the loaded sourceRefs in pdf.js', async () => {
    mocks.annotations = [ink('a', '10R'), ink('b', '12R3')]
    const doc = fakeDoc(uniform)
    mocks.doc = doc
    await DocumentSession.open('C:/docs/f.pdf')
    expect(doc.suppressAnnotations.mock.calls.flatMap((c) => [...(c[0] as Iterable<string>)])).toEqual(['10R', '12R3'])
  })

  it('opens without annotations when they cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.annotations = new Error('InvalidPdf')
    mocks.doc = fakeDoc(uniform)
    const session = await DocumentSession.open('C:/docs/g.pdf')
    expect(session.store.all()).toEqual([])
    expect(error).toHaveBeenCalled()
    expect(toasts.items.at(-1)).toMatchObject({
      message: 'Annotations in this file could not be loaded',
      kind: 'warning',
    })
    error.mockRestore()
  })

  it('anchorView.resized resolves on a viewport size change only', async () => {
    const { resized } = s.anchorView()
    let done = false
    void resized.then(() => (done = true))
    s.setViewport(1000, 500)
    await Promise.resolve()
    expect(done).toBe(false)
    s.setViewport(1000, 900)
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('anchorView restores the page position after a resize clamped the scroll', () => {
    s.goToPage(4)
    const top = s.scrollTop // 2780: the bottom at viewport height 500
    const { restore } = s.anchorView()
    s.setViewport(1000, 900)
    s.setScroll(2380, 0) // the browser clamped it to the new maximum
    restore()
    expect(s.scrollTop).toBe(top)
  })

  it('anchorView skips the restore after the user scrolled', () => {
    s.goToPage(3)
    const { restore } = s.anchorView()
    s.setViewport(1000, 900)
    s.scrollBy(0, 300) // user scroll
    const moved = s.scrollTop
    restore()
    expect(s.scrollTop).toBe(moved)
  })

  it('anchorView is scale independent: a zoom in between keeps the same fraction of the page', () => {
    s.goToPage(3)
    s.scrollBy(0, 200) // 200 pt into the page area above the page top (16pt gap), at scale 1
    const before = (s.scrollTop - s.layout.tops[2]) / 800
    const { restore } = s.anchorView()
    s.zoomTo(2)
    s.setScroll(0, 0) // viewer moved elsewhere
    restore()
    expect((s.scrollTop - s.layout.tops[2]) / (800 * s.scale)).toBeCloseTo(before, 5)
    expect(s.currentPage).toBe(3)
  })

  it('wraps freetext lines on load to the box width on screen (page rotation aware)', async () => {
    const ft = (id: string, page: number, rect: number[]) => ({
      kind: 'freetext', id, page, sourceRef: '20R', modifiedAt: '', author: '', rect,
      text: 'aaa bbb\nccc', lines: [], fontSize: 10, textColor: [0, 0, 0], background: null,
    })
    // 'aaa bbb' is 36.14pt in Helvetica 10pt: fits a 48pt box (40pt text area), not a 30pt one.
    mocks.annotations = [ink('i', '10R'), ft('flat', 0, [0, 0, 48, 30]), ft('turned', 1, [0, 0, 48, 30])]
    const doc = fakeDoc(uniform)
    doc.getPage.mockImplementation(async (i: number) => ({ getViewport: () => uniform[i - 1], rotate: i === 2 ? 90 : 0 }))
    mocks.doc = doc
    const session = await DocumentSession.open('C:/docs/h.pdf')
    expect(session.store.get('flat')).toMatchObject({ lines: ['aaa bbb', 'ccc'] })
    // Rotate 90: the box is 30pt wide on screen (22pt text area).
    expect(session.store.get('turned')).toMatchObject({ lines: ['aaa', 'bbb', 'ccc'] })
    expect(session.store.get('i')).toEqual(ink('i', '10R'))
    expect(session.dirty).toBe(false)
  })

  it('commitPendingEdit runs the pending edit once', () => {
    const commit = vi.fn()
    s.pendingEdit = commit
    s.commitPendingEdit()
    s.commitPendingEdit()
    expect(commit).toHaveBeenCalledOnce()
    expect(s.pendingEdit).toBeNull()
  })

  it('setPath updates path and fileName', () => {
    s.setPath('D:\\out\\copy.pdf')
    expect(s.path).toBe('D:\\out\\copy.pdf')
    expect(s.fileName).toBe('copy.pdf')
  })
})

describe('DocumentSession page operations', () => {
  /** Pages 600x800 (unrotated); page 2 has /Rotate 90, so it shows 800x600. */
  function rotatedDoc() {
    const doc = fakeDoc(uniform)
    doc.getPage.mockImplementation(async (i: number) => {
      const rotate = i === 2 ? 90 : 0
      return {
        rotate,
        getViewport: ({ rotation = rotate }: { rotation?: number } = {}) =>
          rotation % 180 === 0 ? { width: 600, height: 800 } : { width: 800, height: 600 },
      }
    })
    return doc
  }

  async function open() {
    mocks.doc = rotatedDoc()
    const session = await DocumentSession.open('C:/docs/p.pdf')
    await session.pageSizesLoaded
    return session
  }

  it('starts with one unrotated entry per file page', async () => {
    const session = await open()
    expect(session.pages).toEqual([0, 1, 2, 3].map((source) => ({ kind: 'source', source, rotate: 0 })))
    expect(session.pageSizes[1]).toEqual({ width: 800, height: 600 })
  })

  it('rotating a page swaps its size, is undoable and makes the session dirty', async () => {
    const session = await open()
    await session.rotatePage(0, 90)
    expect(session.pages[0].rotate).toBe(90)
    expect(session.pageSizes[0]).toEqual({ width: 800, height: 600 })
    expect(session.dirty).toBe(true)
    expect(await session.pageRotation(0)).toBe(90)
    session.history.undo()
    expect(session.pageSizes[0]).toEqual({ width: 600, height: 800 })
    expect(session.dirty).toBe(false)
  })

  it('rotating keeps pasted images inside the page', async () => {
    const session = await open()
    session.store.add({
      id: 'im', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'image',
      rect: [500, 700, 600, 720], image: { width: 5, height: 1, png: 'AA==' },
    })
    await session.rotatePage(0, 90)
    // Turned about its centre: [540, 660, 560, 760]; the 600 x 800 page holds it.
    expect(session.store.get('im')).toMatchObject({ rect: [540, 660, 560, 760] })
    session.history.undo()
    session.store.update('im', { ...session.store.get('im')!, rect: [0, 0, 100, 20] } as never)
    await session.rotatePage(0, 90)
    // [40, -40, 60, 60] is shifted up onto the page.
    expect(session.store.get('im')).toMatchObject({ rect: [40, 0, 60, 100] })
  })

  it('pageRotation adds the file rotation', async () => {
    const session = await open()
    await session.rotatePage(1, 90)
    expect(await session.pageRotation(1)).toBe(180)
  })

  it('an inserted empty page has the size and effective rotation of the page before it', async () => {
    const session = await open()
    await session.insertBlankPage(1)
    expect(session.pages[2]).toEqual({ kind: 'blank', width: 600, height: 800, rotate: 90 })
    expect(session.pageSizes).toHaveLength(5)
    expect(session.pageSizes[2]).toEqual({ width: 800, height: 600 })
  })

  it('duplicate and delete change the page count; the last page cannot be deleted', async () => {
    const session = await open()
    session.duplicatePage(3)
    expect(session.pageSizes).toHaveLength(5)
    for (let k = 0; k < 4; k++) session.deletePage(0)
    expect(session.pages).toHaveLength(1)
    expect(session.canDeletePage()).toBe(false)
    session.deletePage(0)
    expect(session.pages).toHaveLength(1)
  })

  it('commits a pending text edit before a page operation', async () => {
    const session = await open()
    const commit = vi.fn()
    session.pendingEdit = commit
    session.duplicatePage(0)
    expect(commit).toHaveBeenCalledOnce()
  })
})

describe('DocumentSession page plan and reload', () => {
  async function open() {
    mocks.annotations = []
    mocks.doc = fakeDoc(uniform)
    const session = await DocumentSession.open('C:/docs/r.pdf')
    await session.pageSizesLoaded
    session.setViewport(1000, 500)
    return session
  }

  it('pagePlan is null while the pages are the file order', async () => {
    const session = await open()
    expect(session.pagePlan()).toBeNull()
    session.duplicatePage(0)
    session.history.undo()
    expect(session.pagePlan()).toBeNull()
  })

  it('pagePlan lists the pages with absolute rotations', async () => {
    const session = await open()
    const doc = mocks.doc as ReturnType<typeof fakeDoc>
    doc.getPage.mockImplementation(async (i: number) => ({ getViewport: () => uniform[i - 1], rotate: i === 1 ? 90 : 0 }))
    session.duplicatePage(0)
    session.deletePage(3)
    expect(await session.pagePlan()).toEqual([
      { kind: 'source', index: 0, rotate: 90 },
      { kind: 'source', index: 0, rotate: 90 },
      { kind: 'source', index: 1, rotate: 0 },
      { kind: 'source', index: 3, rotate: 0 },
    ])
  })

  it('reload replaces doc, pages, annotations and history and keeps the view', async () => {
    const session = await open()
    session.duplicatePage(1)
    session.goToPage(3)
    const top = session.scrollTop
    const old = mocks.doc as ReturnType<typeof fakeDoc>
    const saved = fakeDoc(Array.from({ length: 5 }, () => uniform[0]))
    mocks.doc = saved
    mocks.annotations = [{
      kind: 'ink', id: 'x', page: 2, sourceRef: '40R', modifiedAt: '', author: '',
      strokes: [[[0, 0], [1, 1]]], color: [0, 0, 0], width: 1, opacity: 1, blend: 'normal', role: 'pen',
    }]
    const evict = vi.spyOn(renderCache, 'evictPrefix')
    await session.reload()
    expect(session.doc).toBe(saved)
    expect(old.destroy).toHaveBeenCalled()
    expect(evict).toHaveBeenCalledWith(`${session.id}:`)
    expect(session.pages).toHaveLength(5)
    expect(session.pagePlan()).toBeNull()
    expect(session.store.get('x')!.sourceRef).toBe('40R')
    expect(saved.suppressAnnotations).toHaveBeenCalled()
    expect(session.history.canUndo).toBe(false)
    expect(session.dirty).toBe(false)
    expect(session.scrollTop).toBe(top)
    expect(session.currentPage).toBe(3)
  })
})

describe('DocumentSession current page and page changes', () => {
  it('deleting the current last page clamps currentPage', async () => {
    mocks.doc = fakeDoc(uniform)
    const session = await DocumentSession.open('C:/docs/c1.pdf')
    await session.pageSizesLoaded
    session.setViewport(1000, 500)
    session.goToPage(4)
    session.deletePage(3)
    expect(session.currentPage).toBe(3)
    session.deletePage(2)
    session.deletePage(1)
    expect(session.currentPage).toBe(1)
  })

  it('late page sizes never make the scroll position NaN for an out-of-range current page', async () => {
    let release!: () => void
    mocks.doc = fakeDoc(
      [{ width: 600, height: 800 }, { width: 600, height: 1000 }, { width: 800, height: 600 }, { width: 600, height: 800 }],
      new Promise<void>((r) => (release = r)),
    )
    const session = await DocumentSession.open('C:/docs/c2.pdf')
    session.setViewport(1000, 500)
    session.currentPage = 9
    release()
    await session.pageSizesLoaded
    expect(Number.isNaN(session.scrollTop)).toBe(false)
  })
})
