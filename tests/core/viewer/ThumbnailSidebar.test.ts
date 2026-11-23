import { fireEvent, render } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import ThumbnailSidebar from '../../../src/core/viewer/ThumbnailSidebar.svelte'
import { thumbnailLayout } from '../../../src/core/viewer/thumbnailList'

const A4 = { width: 595, height: 842 }

function fakeSession(n: number, currentPage = 1) {
  return {
    id: 's1',
    currentPage,
    pageSizes: Array.from({ length: n }, () => A4),
    pages: Array.from({ length: n }, (_, i) => ({ kind: 'source', source: i, rotate: 0 })),
    store: { byPage: () => [] },
    // Thumbnails never finish rendering here; the test is about the list.
    doc: { destroyed: false, getPage: () => new Promise(() => {}) },
    goToPage: vi.fn(),
  } as unknown as DocumentSession
}

let restore: () => void
beforeEach(() => {
  // jsdom has no layout: give the scroller a 600 px tall view.
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  restore = () => Object.defineProperty(Element.prototype, 'clientHeight', desc)
})
afterEach(() => restore())

describe('ThumbnailSidebar', () => {
  it('mounts only the tiles in view of a long document', () => {
    const { getAllByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(500), side: 'left' } })
    const tiles = getAllByRole('button')
    expect(tiles.length).toBeGreaterThan(2)
    expect(tiles.length).toBeLessThan(15)
    expect(tiles[0].getAttribute('aria-label')).toBe('Page 1')
  })

  it('marks the current page and goes to a clicked one', async () => {
    const s = fakeSession(5, 2)
    const { getByRole } = render(ThumbnailSidebar, { props: { session: s, side: 'right' } })
    expect(getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page')
    expect(getByRole('button', { name: 'Page 1' }).hasAttribute('aria-current')).toBe(false)
    await fireEvent.click(getByRole('button', { name: 'Page 4' }))
    expect(s.goToPage).toHaveBeenCalledWith(4)
  })

  it('scrolls the current page into view on opening', () => {
    const { container, getByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(300, 200), side: 'left' } })
    const scroller = container.querySelector('.scroller') as HTMLElement
    const l = thumbnailLayout(fakeSession(300).pageSizes)
    expect(scroller.scrollTop).toBeCloseTo(l.tops[199] + l.heights[199] / 2 - 300)
    expect(getByRole('button', { name: 'Page 200' }).getAttribute('aria-current')).toBe('page')
  })

  it('scrolls on Ctrl + scroll (Ctrl held) but leaves a pinch alone', () => {
    const { container } = render(ThumbnailSidebar, { props: { session: fakeSession(300), side: 'left' } })
    const scroller = container.querySelector('.scroller') as HTMLElement
    const wheel = (deltaY: number, deltaMode = 0) => {
      const e = new WheelEvent('wheel', { ctrlKey: true, deltaY, deltaMode, bubbles: true, cancelable: true })
      scroller.dispatchEvent(e)
      return e
    }

    // Pinch: ctrlKey set without Ctrl held; left to pageZoomGuard.
    expect(wheel(-10).defaultPrevented).toBe(false)
    expect(scroller.scrollTop).toBe(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    // Two-finger touchpad scroll and a mouse wheel notch both scroll.
    expect(wheel(30).defaultPrevented).toBe(true)
    expect(scroller.scrollTop).toBe(30)
    expect(wheel(100).defaultPrevented).toBe(true)
    expect(scroller.scrollTop).toBe(130)
    // Line-mode deltas are converted to pixels.
    wheel(2, 1)
    expect(scroller.scrollTop).toBe(162)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }))
  })

  it('resizes from the edge facing the pages: live while dragged, saved on release', async () => {
    const onresize = vi.fn()
    const { getByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(5), side: 'left', width: 160, onresize } })
    const handle = getByRole('separator', { name: 'Resize page thumbnails' })
    handle.setPointerCapture = () => {}
    await fireEvent.pointerDown(handle, { button: 0, clientX: 160, pointerId: 1 })
    await fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 })
    expect(onresize).toHaveBeenLastCalledWith(200, false)
    // Clamped to the widest the sidebar may get.
    await fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 })
    expect(onresize).toHaveBeenLastCalledWith(360, false)
    await fireEvent.pointerUp(handle, { clientX: 900, pointerId: 1 })
    // The width as given by the parent (still 160 here) is the one saved.
    expect(onresize).toHaveBeenLastCalledWith(160, true)
  })

  it('widens leftwards when on the right, resets on double-click and steps with arrow keys', async () => {
    const onresize = vi.fn()
    const { getByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(5), side: 'right', width: 200, onresize } })
    const handle = getByRole('separator')
    handle.setPointerCapture = () => {}
    await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    await fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 })
    expect(onresize).toHaveBeenLastCalledWith(240, false)
    await fireEvent.pointerUp(handle, { pointerId: 1 })
    await fireEvent.dblClick(handle)
    expect(onresize).toHaveBeenLastCalledWith(160, true)
    await fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onresize).toHaveBeenLastCalledWith(216, true)
  })

  it('lays the tiles out for the width it is given', () => {
    const { getByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(3), side: 'left', width: 272, renderWidth: 160 } })
    const page = getByRole('button', { name: 'Page 1' }).querySelector('.page') as HTMLElement
    // Box 224: an A4 preview 224 x 317, whatever width its bitmap is rendered for.
    expect([page.style.width, page.style.height]).toEqual(['224px', '317px'])
  })

  it('has no resize handle without onresize', () => {
    const { queryByRole } = render(ThumbnailSidebar, { props: { session: fakeSession(3), side: 'left' } })
    expect(queryByRole('separator')).toBeNull()
  })
})
