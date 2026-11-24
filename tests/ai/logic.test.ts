import { describe, expect, it } from 'vitest'
import { generationAction } from '../../src/ai/action'
import { chunkPages, DEFAULT_LIMITS } from '../../src/ai/chunking'
import { parseAnswerLine } from '../../src/ai/parse'
import { cleanPageText, MAX_PAGE_CHARS, type PageText } from '../../src/ai/prompt'
import { retryPages } from '../../src/ai/retry'

const pages = (n: number, text = 'Some slide text'): PageText[] =>
  Array.from({ length: n }, (_, i) => ({ page: i + 1, text }))

describe('chunkPages', () => {
  it('sends a document of up to 150 pages in exactly one request', () => {
    for (const n of [1, 40, 100, 150]) {
      const chunks = chunkPages(pages(n))
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toHaveLength(n)
    }
  })

  it('splits above the threshold into a few even chunks, every page once, in order', () => {
    const chunks = chunkPages(pages(151))
    expect(chunks.map((c) => c.length)).toEqual([76, 75])
    expect(chunks.flat().map((p) => p.page)).toEqual(pages(151).map((p) => p.page))
    expect(chunkPages(pages(400)).map((c) => c.length)).toEqual([134, 134, 132])
  })

  it('splits when the expected answer comes close to the output limit', () => {
    const limits = { ...DEFAULT_LIMITS, maxOutputTokens: 1400, tokensPerPage: 140 } // 10 pages per request
    expect(chunkPages(pages(25), limits).map((c) => c.length)).toEqual([9, 9, 7])
  })

  it('splits a huge text even under the page threshold', () => {
    const limits = { ...DEFAULT_LIMITS, maxInputChars: 1000 }
    expect(chunkPages(pages(4, 'x'.repeat(400)), limits).map((c) => c.length)).toEqual([2, 2])
  })

  it('has no chunk for no pages', () => {
    expect(chunkPages([])).toEqual([])
  })
})

describe('parseAnswerLine', () => {
  it('reads one JSON object per line', () => {
    expect(parseAnswerLine('{"page": 3, "text": "Zellen bestehen aus …"}')).toEqual({ page: 3, text: 'Zellen bestehen aus …' })
    expect(parseAnswerLine('  {"page":"4","text":" trimmed "}  ')).toEqual({ page: 4, text: 'trimmed' })
  })

  it('tolerates array brackets and trailing commas', () => {
    expect(parseAnswerLine('[{"page": 1, "text": "a"},')).toEqual({ page: 1, text: 'a' })
    expect(parseAnswerLine('{"page": 2, "text": "b"}]')).toEqual({ page: 2, text: 'b' })
  })

  it('skips fences, prose, partial and broken lines', () => {
    for (const line of [
      '```json',
      '```',
      'Here are the explanations:',
      '{"page": 1, "text": "cut off',
      '{"page": 1 "text": "x"}',
      '"page": 1, "text": "x"}',
      '',
    ]) {
      expect(parseAnswerLine(line), line).toBeNull()
    }
  })

  it('skips objects without a usable page number or text', () => {
    for (const line of [
      '{"page": 0, "text": "x"}',
      '{"page": 1.5, "text": "x"}',
      '{"page": "two", "text": "x"}',
      '{"page": 1, "text": "   "}',
      '{"page": 1, "text": 7}',
      '{"text": "x"}',
      '[1, 2]',
    ]) {
      expect(parseAnswerLine(line), line).toBeNull()
    }
  })
})

describe('retryPages', () => {
  it('continues from the first missing page', () => {
    expect(retryPages([0, 1, 2, 4, 5], new Set([0, 1]))).toEqual([2, 4, 5])
  })

  it('skips pages that arrived out of order after the first gap', () => {
    expect(retryPages([0, 1, 2, 3], new Set([0, 2]))).toEqual([1, 3])
  })

  it('is empty when everything arrived', () => {
    expect(retryPages([0, 1], new Set([0, 1]))).toEqual([])
    expect(retryPages([], new Set())).toEqual([])
  })
})

describe('generationAction', () => {
  it('adds without asking while no page has an explanation', () => {
    expect(generationAction(false)).toEqual({ label: 'Add explanations', confirm: null })
  })

  it('regenerates and warns about overwriting (hand edits included) once one exists', () => {
    const a = generationAction(true)
    expect(a.label).toBe('Regenerate explanations')
    expect(a.confirm).toMatch(/replaces the existing explanations/)
    expect(a.confirm).toMatch(/by hand/)
  })
})

describe('prompt', () => {
  it('collapses blank space and cuts very long pages', () => {
    expect(cleanPageText('  a   b \n\n  c  ')).toBe('a b\nc')
    const long = cleanPageText('x'.repeat(MAX_PAGE_CHARS + 50))
    expect(long.length).toBeLessThan(MAX_PAGE_CHARS + 10)
    expect(long.endsWith('[…]')).toBe(true)
  })
})
