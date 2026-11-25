import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeRenderDoc } from './fakeDoc'

const mocks = vi.hoisted(() => ({ doc: null as unknown }))
vi.mock('../../../src/core/ipc/api', () => ({
  openPdf: async () => new ArrayBuffer(8),
  readDocument: async () => ({ annotations: [], explanations: [] }),
  loadSettings: async () => null,
  saveSettings: async () => {},
}))
vi.mock('../../../src/core/viewer/pdfEngine', () => ({ loadPdf: async () => mocks.doc }))

import { DocumentSession } from '../../../src/core/session/session.svelte'
import Viewer from '../../../src/core/viewer/Viewer.svelte'
import { renderCache } from '../../../src/core/viewer/renderCache'

// jsdom has no layout: give elements a writable scroll position and a no-op ResizeObserver.
const scrollProps = ['scrollTop', 'scrollLeft'] as const
beforeEach(() => {
  for (const prop of scrollProps) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: Record<string, number>) {
        return this[`_${prop}`] ?? 0
      },
      set(this: Record<string, number>, v: number) {
        this[`_${prop}`] = v
      },
    })
  }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  for (const prop of scrollProps) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Viewer', () => {
  it('renders only pages in range and cancels renders of pages that leave it', async () => {
    const { doc, renders } = fakeRenderDoc(20)
    mocks.doc = doc
    const session = await DocumentSession.open('C:/docs/v.pdf')
    await session.pageSizesLoaded
    const setSpy = vi.spyOn(renderCache, 'set')
    const { container } = render(Viewer, { props: { session } })
    session.setViewport(800, 600)
    await tick()
    // Viewport 0–600 shows page 1; overscan adds page 2.
    await vi.waitFor(() => expect(renders.map((r) => r.page).sort()).toEqual([1, 2]))
    expect(container.querySelectorAll('.page')).toHaveLength(2)

    session.goToPage(10)
    await tick()
    expect(renders.filter((r) => r.page <= 2).every((r) => r.cancel.mock.calls.length === 1)).toBe(true)
    await vi.waitFor(() => expect(renders.map((r) => r.page)).toContain(10))
    const pages = [...container.querySelectorAll('.page')]
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.length).toBeLessThanOrEqual(4)
    expect(setSpy).not.toHaveBeenCalled()
    await session.dispose()
  })

  it('keeps the page a cross-page drag started on mounted', async () => {
    const { doc } = fakeRenderDoc(20)
    mocks.doc = doc
    const session = await DocumentSession.open('C:/docs/v.pdf')
    await session.pageSizesLoaded
    const { container, rerender } = render(Viewer, { props: { session } })
    session.setViewport(800, 600)
    await tick()
    expect(container.querySelectorAll('.page')).toHaveLength(2)
    await rerender({ session, crossDrag: { page: 15 } })
    expect(container.querySelectorAll('.page')).toHaveLength(3)
    // The page the element is on now stays mounted too.
    await rerender({ session, crossDrag: { page: 15, at: 17 } })
    expect(container.querySelectorAll('.page')).toHaveLength(4)
    await rerender({ session, crossDrag: null })
    expect(container.querySelectorAll('.page')).toHaveLength(2)
    await session.dispose()
  })

  it('zooms on pinch and Ctrl + mouse wheel; Ctrl + two-finger scroll scrolls instead', async () => {
    const { doc } = fakeRenderDoc(5)
    mocks.doc = doc
    const session = await DocumentSession.open('C:/docs/v.pdf')
    await session.pageSizesLoaded
    const { container, unmount } = render(Viewer, { props: { session } })
    session.setViewport(800, 600)
    await tick()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const viewer = container.querySelector('.viewer')!
      const zoomSpy = vi.spyOn(session, 'zoomTo')
      const wheel = (deltaY = -10, deltaX = 0) => {
        const e = new WheelEvent('wheel', { ctrlKey: true, deltaY, deltaX, bubbles: true, cancelable: true })
        viewer.dispatchEvent(e)
        return e
      }

      // Pinch: WebView2 sets ctrlKey on the wheel event without Ctrl held.
      expect(wheel().defaultPrevented).toBe(true)
      vi.advanceTimersByTime(200)
      expect(zoomSpy).toHaveBeenCalledTimes(1)

      // Ctrl + two-finger scroll: cancelled (no UI zoom), scrolls as if Ctrl weren't held.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
      const top = viewer.scrollTop
      const left = viewer.scrollLeft
      expect(wheel(30, 12).defaultPrevented).toBe(true)
      expect(viewer.scrollTop).toBe(top + 30)
      expect(viewer.scrollLeft).toBe(left + 12)
      vi.advanceTimersByTime(200)
      expect(zoomSpy).toHaveBeenCalledTimes(1)

      // Ctrl + mouse wheel: a notch-sized delta still zooms.
      expect(wheel(-100).defaultPrevented).toBe(true)
      vi.advanceTimersByTime(200)
      expect(zoomSpy).toHaveBeenCalledTimes(2)

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }))
    } finally {
      vi.useRealTimers()
    }
    unmount()
    await session.dispose()
  })
})
