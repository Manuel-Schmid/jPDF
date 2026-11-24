import { describe, expect, it } from 'vitest'
import { chunkPlanned, contextFor, DEFAULT_LIMITS, PICTURE_CHARS, type PlannedPage } from '../../src/ai/chunking'
import { CODEX_LIMITS } from '../../src/ai/cliGenerator'
import type { PageText } from '../../src/ai/prompt'

const planned = (n: number, picture = (_: number) => false, text = 'Some slide text'): PlannedPage[] =>
  Array.from({ length: n }, (_, i) => ({ page: i + 1, text, picture: picture(i + 1) }))
const sizes = (chunks: PlannedPage[][]) => chunks.map((c) => c.length)
const texts = (n: number, text = 'abc'): PageText[] => Array.from({ length: n }, (_, i) => ({ page: i + 1, text }))

describe('chunkPlanned', () => {
  it('keeps 56 text pages in one chunk', () => {
    expect(sizes(chunkPlanned(planned(56)))).toEqual([56])
  })

  it('splits 56 pictured pages into two chunks of 28 for Claude', () => {
    expect(sizes(chunkPlanned(planned(56, () => true)))).toEqual([28, 28])
  })

  it('keeps 30 pictured among 150 pages in one chunk', () => {
    expect(sizes(chunkPlanned(planned(150, (p) => p <= 30)))).toEqual([150])
  })

  it('cuts bunched pictures greedily at the cap, every page once in order', () => {
    const pages = planned(120, (p) => p <= 60)
    const chunks = chunkPlanned(pages)
    // Even parts would need three requests; cutting at the cap needs two.
    expect(chunks).toHaveLength(2)
    for (const c of chunks) expect(c.filter((p) => p.picture).length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxPictures)
    expect(chunks.flat().map((p) => p.page)).toEqual(pages.map((p) => p.page))
  })

  it('splits 45 pages for Codex into 15/15/15', () => {
    expect(sizes(chunkPlanned(planned(45), CODEX_LIMITS))).toEqual([15, 15, 15])
  })

  it('keeps a single page in one chunk', () => {
    expect(sizes(chunkPlanned(planned(1, () => true)))).toEqual([1])
  })

  it('splits into balanced parts, larger first', () => {
    expect(sizes(chunkPlanned(planned(10), { ...DEFAULT_LIMITS, maxPages: 3 }))).toEqual([3, 3, 2, 2])
  })

  it('greedy fallback respects the page cap', () => {
    const limits = { ...DEFAULT_LIMITS, maxPages: 10, maxPictures: 3 }
    // Pictures bunched at the front force the greedy cut.
    const chunks = chunkPlanned(planned(25, (p) => p <= 9), limits)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10)
    expect(chunks.flat().map((p) => p.page)).toEqual(planned(25).map((p) => p.page))
  })

  it('greedy fallback respects the char cap', () => {
    const limits = { ...DEFAULT_LIMITS, maxPictures: 1, maxInputChars: 250 }
    const pages = planned(6, (p) => p <= 2, 'x'.repeat(100))
    const chunks = chunkPlanned(pages, limits)
    for (const c of chunks) expect(c.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(250)
    expect(chunks.flat()).toHaveLength(6)
  })

  it('checks the char cap per even part', () => {
    const limits = { ...DEFAULT_LIMITS, maxInputChars: 500 }
    const pages: PlannedPage[] = [100, 100, 100, 400, 100, 100].map((n, i) => ({ page: i + 1, text: 'x'.repeat(n), picture: false }))
    for (const c of chunkPlanned(pages, limits)) expect(c.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(500)
  })

  it('has no chunk for no pages', () => {
    expect(chunkPlanned([])).toEqual([])
  })
})

describe('contextFor', () => {
  it('is null when the chunk covers the whole document', () => {
    expect(contextFor(texts(5), planned(5), 1000)).toBeNull()
  })

  it('is non-null when the chunk covers only part of the document', () => {
    expect(contextFor(texts(5), planned(5).slice(0, 2), 1000)).not.toBeNull()
  })

  it('is every page when the text is small', () => {
    const all = texts(100)
    expect(contextFor(all, planned(100).slice(10, 20), 1000)).toBe(all)
  })

  it("counts the chunk's pictures against the input limit", () => {
    const all = texts(200, 'x'.repeat(100)) // 20 000 characters
    const chunk = (pictured: number) => planned(200, (p) => p >= 100 && p < 100 + pictured).slice(99, 110)
    const limit = 20_000 + 2 * PICTURE_CHARS
    expect(contextFor(all, chunk(2), limit)).toBe(all)
    const ctx = contextFor(all, chunk(3), limit)!
    expect(ctx).toHaveLength(91)
    expect(ctx[0].page).toBe(60)
  })

  it('is the pages within 40 of the chunk when the text is huge', () => {
    const all = texts(200, 'x'.repeat(100))
    const ctx = contextFor(all, planned(200).slice(99, 110), 1000)!
    expect(ctx[0].page).toBe(60)
    expect(ctx[ctx.length - 1].page).toBe(150)
  })
})
