import { describe, expect, it } from 'vitest'
import { chunkPlanned, contextFor, DEFAULT_LIMITS, type PlannedPage } from '../../src/ai/chunking'
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

  it('has no chunk for no pages', () => {
    expect(chunkPlanned([])).toEqual([])
  })
})

describe('contextFor', () => {
  it('is null when the chunk covers the whole document', () => {
    expect(contextFor(texts(5), planned(5), 1000)).toBeNull()
  })

  it('is every page when the text is small', () => {
    const all = texts(100)
    expect(contextFor(all, planned(100).slice(10, 20), 1000)).toBe(all)
  })

  it('is the pages within 40 of the chunk when the text is huge', () => {
    const all = texts(200, 'x'.repeat(100))
    const ctx = contextFor(all, planned(200).slice(99, 110), 1000)!
    expect(ctx[0].page).toBe(60)
    expect(ctx[ctx.length - 1].page).toBe(150)
  })
})
