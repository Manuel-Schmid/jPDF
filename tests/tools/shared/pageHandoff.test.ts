import { describe, expect, it, vi } from 'vitest'
import { createPageHandoff } from '../../../src/tools/shared/pageHandoff'
import type { PageFrame } from '../../../src/core/registry/tools'
import type { Point } from '../../../src/core/session/model'

/** A 100 × 200 pt page at scale 1, no rotation: PDF y runs up from the bottom. */
const vp = () =>
  ({
    scale: 1,
    width: 100,
    height: 200,
    viewBox: [0, 0, 100, 200],
    convertToPdfPoint: (x: number, y: number) => [x, 200 - y],
  }) as never

/** Pages stacked vertically with a 16 px gap; page i's top-left corner in client px. */
const originOf = (page: number, scroll = 0): Point => [0, page * 216 - scroll]

function setup(home: number, pages = 3) {
  const vps = Array.from({ length: pages }, vp)
  const frameOf = vi.fn((q: number): PageFrame | null => (q < pages ? { vp: vps[q], origin: originOf(q) } : null))
  const h = createPageHandoff(home, vps[home], frameOf, false)
  /** Adds a client point, with the home page's PDF point as the overlay computes it. */
  const add = (x: number, y: number, scroll = 0) => {
    const o = originOf(home, scroll)
    h.add([x, y], o, [x - o[0], 200 - (y - o[1])], 0.5)
  }
  return { h, add, frameOf }
}

describe('createPageHandoff', () => {
  it('records nothing while the stroke stays on its page, and looks up no other page', () => {
    const { h, add, frameOf } = setup(0)
    add(10, 10)
    add(20, 100)
    add(30, 190)
    expect(h.away.size).toBe(0)
    expect(frameOf).not.toHaveBeenCalled()
  })

  it('continues on the next page from the last point before it', () => {
    const { h, add } = setup(0)
    add(10, 190)
    add(10, 208) // in the gap
    add(10, 226) // 10 px into page 1
    add(10, 246)
    expect([...h.away.keys()]).toEqual([1])
    // In page 1's PDF space: the gap point lies above its top (y > 200).
    expect(h.away.get(1)!.strokes).toEqual([[[10, 208], [10, 190], [10, 170]]])
    expect(h.viewport(1)).not.toBeNull()
  })

  it('continues on the previous page too', () => {
    const { h, add } = setup(1)
    add(10, 226)
    add(10, 205)
    add(10, 190)
    expect(h.away.get(0)!.strokes).toEqual([[[10, -5], [10, 10]]])
  })

  it('back on the home page, the home page takes over again', () => {
    const { h, add } = setup(0)
    add(10, 190)
    add(10, 230)
    add(10, 190) // back on page 0
    add(10, 180)
    // Page 1's stroke ends with the point that left it; nothing more is added.
    expect(h.away.get(1)!.strokes).toEqual([[[10, 226], [10, 186], [10, 226]]])
  })

  it('each visit to another page is its own stroke there', () => {
    const { h, add } = setup(0)
    add(10, 190)
    add(10, 230)
    add(10, 190)
    add(20, 230)
    expect(h.away.get(1)!.strokes).toHaveLength(2)
  })

  it('goes on across several pages', () => {
    const { h, add } = setup(0)
    add(10, 190)
    add(10, 230)
    add(10, 420)
    add(10, 440) // page 2 starts at 432
    expect([...h.away.keys()]).toEqual([1, 2])
  })

  it('looks each page up once per stroke and follows scrolling without new lookups', () => {
    const { h, add, frameOf } = setup(0)
    add(10, 190)
    add(10, 230)
    const calls = frameOf.mock.calls.length
    // The view scrolls by 50 px: the same client point is 50 px further down the pages.
    add(10, 180, 50)
    expect(frameOf.mock.calls.length).toBe(calls)
    expect(h.away.get(1)!.strokes[0].at(-1)).toEqual([10, 200 - (180 + 50 - 216)])
  })

  it('records pressure per point, starting with the point before the page', () => {
    const vps = [vp(), vp()]
    const h = createPageHandoff(0, vps[0], (q) => (q < 2 ? { vp: vps[q], origin: originOf(q) } : null), true)
    h.add([10, 190], [0, 0], [10, 10], 0.2)
    h.add([10, 230], [0, 0], [10, -30], 0.4)
    expect(h.away.get(1)!.pressure).toEqual([[0.2, 0.4]])
  })
})
