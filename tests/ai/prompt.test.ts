import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, pageRanges, revisionNote, userPrompt, type PromptInput } from '../../src/ai/prompt'

const pg = (...n: number[]) => n.map((page) => ({ page, text: `text ${page}` }))

function input(over: Partial<PromptInput>): PromptInput {
  return { explain: pg(1, 2, 3), context: null, total: 3, pictures: [], note: 'claude', ...over }
}

describe('system prompt', () => {
  it('has the study rules', () => {
    for (const s of [
      'Never begin with "This slide"',
      'model answer',
      'animation step',
      'short concrete example',
      'Plain text only',
      '{"page": <page number>, "text": "<explanation>"}',
    ]) {
      expect(SYSTEM_PROMPT).toContain(s)
    }
  })
})

describe('userPrompt', () => {
  it('whole document, no pictures', () => {
    const p = userPrompt(input({}))
    expect(p.startsWith('Explain all 3 pages of this document (one JSON line per page: 3 lines).')).toBe(true)
    expect(p).not.toContain('attached')
    expect(p).toContain('=== Page 1 ===\ntext 1')
    expect(p).toContain('=== Page 3 ===\ntext 3')
  })

  it('whole document with pictures, claude', () => {
    const p = userPrompt(input({ explain: pg(2, 3), total: 2, pictures: [2, 3] }))
    expect(p).toContain('Pictures of pages 2, 3 are attached.')
  })

  it('one picture is named in the singular', () => {
    const one = { explain: pg(2, 3), total: 2, pictures: [2] }
    expect(userPrompt(input(one))).toContain('Picture of page 2 is attached.')
    const codex = userPrompt(input({ ...one, note: 'codex' }))
    expect(codex).toContain('The attached picture shows page 2.')
    expect(codex).not.toContain('in this order')
  })

  it('codex picture sentence', () => {
    const p = userPrompt(input({ explain: pg(2, 3), total: 2, pictures: [2, 3], note: 'codex' }))
    expect(p).toContain('The attached pictures show pages 2, 3, in this order.')
    expect(p).not.toContain('Pictures of pages')
  })

  it('chunk carries full context', () => {
    const p = userPrompt(input({ explain: pg(4, 5, 6), context: pg(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), total: 10 }))
    expect(p.startsWith('Document text (all 10 pages, for context):')).toBe(true)
    expect(p).toContain('=== Page 10 ===')
    expect(p).toContain('Explain pages 4–6 of this document (one JSON line per page: 3 lines).')
    expect(p.indexOf('=== Page 10 ===')).toBeLessThan(p.indexOf('Explain pages 4–6'))
  })

  it('names a context window that is not the whole document', () => {
    const p = userPrompt(input({ explain: pg(50), context: pg(10, 11, 12), total: 200 }))
    expect(p).toContain('Document text (pages 10–12 of 200, for context):')
    expect(p).toContain('Explain page 50 of this document')
  })

  it('retry lists scattered pages', () => {
    const p = userPrompt(input({ explain: pg(5, 17, 18, 40), context: pg(5, 17, 18, 40), total: 40 }))
    expect(p).toContain('Explain pages 5, 17–18, 40')
    expect(p).toContain('4 lines')
  })

  it('pictured page without text', () => {
    const p = userPrompt(input({ explain: [{ page: 7, text: '' }], total: 7, context: null, pictures: [7] }))
    expect(p).toContain('=== Page 7 ===\n(no text; see its picture)')
  })

  it('leaves out a page without text and without picture', () => {
    const p = userPrompt(input({ explain: [{ page: 1, text: 'a' }, { page: 2, text: ' ' }], total: 2 }))
    expect(p).not.toContain('=== Page 2 ===')
  })
})

describe('revision of one page', () => {
  it('follows the page texts with the current explanation and the request', () => {
    const p = userPrompt(input({ explain: pg(3), context: pg(1, 2, 3, 4), total: 4, revision: { instruction: 'Simpler', current: 'Old text.' } }))
    expect(p).toContain('Explain page 3 of this document (one JSON line per page: 1 lines).')
    expect(p.indexOf('Explain page 3')).toBeLessThan(p.indexOf("The page's current explanation:\nOld text."))
    expect(p.endsWith('keep the answer format (one JSON line).')).toBe(true)
    expect(p).toContain('follows this request: Simpler')
  })

  it('without a request asks for a fresh explanation, and adds nothing without a current one', () => {
    expect(revisionNote({ instruction: null, current: 'Old.' })).toContain('instead of repeating the current one')
    expect(revisionNote({ instruction: '  ', current: null })).toBe('')
    const plain = userPrompt(input({ explain: pg(3), context: pg(1, 2, 3), total: 3 }))
    expect(userPrompt(input({ explain: pg(3), context: pg(1, 2, 3), total: 3, revision: { instruction: null, current: null } }))).toBe(plain)
  })
})

describe('pageRanges', () => {
  it('uses a range when contiguous and runs otherwise', () => {
    expect(pageRanges([4, 5, 6])).toBe('4–6')
    expect(pageRanges([5, 17, 18, 40])).toBe('5, 17–18, 40')
    expect(pageRanges([9])).toBe('9')
    expect(pageRanges([3, 8])).toBe('3, 8')
    expect(pageRanges([])).toBe('')
  })

  it('names the context around one missing page as two runs', () => {
    const pages = [1, 2, 3, 4, ...Array.from({ length: 51 }, (_, i) => i + 6)]
    expect(pageRanges(pages)).toBe('1–4, 6–56')
  })
})
