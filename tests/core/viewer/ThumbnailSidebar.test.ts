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
})
