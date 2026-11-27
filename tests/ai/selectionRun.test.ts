import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplanationGenerator, GenerationRequest } from '../../src/ai/generator'
import { GenerationRuns } from '../../src/ai/runs.svelte'
import { appended, explainSelection, selectionLabel, textInRect, type SelectionSession } from '../../src/ai/selectionRun'
import { areaCrop } from '../../src/ai/pictures/render'
import { selectionPrompt } from '../../src/ai/prompt'
import type { Explanation } from '../../src/core/session/model'
import { identityPages, type PageEntry } from '../../src/core/session/pages'

const { renderArea } = vi.hoisted(() => ({
  renderArea: vi.fn(async (_doc: unknown, _entry: unknown, _rect: unknown, page: number) => ({ page, mediaType: 'image/jpeg' as const, data: `area${page}` })),
}))
vi.mock('../../src/ai/pictures/render', async (orig) => ({ ...(await orig<typeof import('../../src/ai/pictures/render')>()), renderArea }))

beforeEach(() => renderArea.mockClear())

/** A text item at (x, y) in PDF user space. */
const item = (str: string, x: number, y: number) => ({ str, hasEOL: false, transform: [1, 0, 0, 1, x, y] })

/** Pages whose items are `pages[i]`; explanation of page 2 (index 1) set. */
function fakeSession(pages: ReturnType<typeof item>[][]) {
  const s = {
    id: 's',
    doc: { getPage: async (n: number) => ({ getTextContent: async () => ({ items: pages[n - 1] }) }) },
    pages: identityPages(pages.length) as PageEntry[],
    explanations: pages.map(() => null) as (Explanation | null)[],
    addGenerated: vi.fn((i: number, e: Explanation) => {
      s.explanations[i] = e
    }),
    endGenerated: vi.fn(),
  }
  return s as typeof s & SelectionSession
}

function fakeGenerator(answer: (req: GenerationRequest) => string | null, pictures = true) {
  const requests: GenerationRequest[] = []
  const gen: ExplanationGenerator = {
    model: 'test-model',
    pictureNote: 'claude',
    pictures,
    generate: async (req, onLine) => {
      requests.push(req)
      const a = answer(req)
      if (a !== null) onLine(a)
      return 'done'
    },
  }
  return { gen, requests }
}

const doc = () => [
  [item('Intro', 10, 700)],
  [item('E = mc^2', 100, 400), item('Footnote', 100, 50)],
  [item('Outro', 10, 700)],
]

describe('explainSelection', () => {
  it('an area: its picture and the text inside it are sent, and the answer is appended to that page', async () => {
    const s = fakeSession(doc())
    s.explanations[1] = { text: 'Energy and mass.', model: 'm', createdAt: 't' }
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(() => JSON.stringify({ page: 2, text: 'Mass times c squared.' }))
    const controller = new AbortController()
    runs.update('s', { controller })
    await explainSelection(s, gen, { page: 1, rect: [50, 350, 300, 450] }, { runs, pictures: true, controller, now: () => 'T' })
    expect(renderArea).toHaveBeenCalledOnce()
    expect(requests[0].images.map((i) => i.data)).toEqual(['area2'])
    expect(requests[0].user).toContain('The selected area contains this text:\nE = mc^2')
    expect(requests[0].user).not.toMatch(/contains this text:[^]*Footnote/)
    expect(s.explanations[1]).toEqual({ text: 'Energy and mass.\n\nOn the selected area: Mass times c squared.', model: 'test-model', createdAt: 'T' })
    expect(runs.get('s')).toBeUndefined()
  })

  it('selected text: no picture, the text itself is asked about, and the label quotes it', async () => {
    const s = fakeSession(doc())
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(() => JSON.stringify({ page: 2, text: 'It relates energy to mass.' }))
    const controller = new AbortController()
    runs.update('s', { controller })
    await explainSelection(s, gen, { page: 1, text: 'E = mc^2' }, { runs, pictures: true, controller })
    expect(renderArea).not.toHaveBeenCalled()
    expect(requests[0].images).toEqual([])
    expect(requests[0].user).toContain('Explain only this text the student selected on page 2, not the whole page:\nE = mc^2')
    expect(s.explanations[1]?.text).toBe('On "E = mc^2": It relates energy to mass.')
  })

  it('an area without text and a model without pictures is refused without a request', async () => {
    const s = fakeSession(doc())
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(() => null, false)
    const controller = new AbortController()
    runs.update('s', { controller })
    await explainSelection(s, gen, { page: 1, rect: [400, 600, 500, 700] }, { runs, pictures: true, controller })
    expect(requests).toEqual([])
    expect(runs.get('s')?.message).toBe("The selected area has no text, and this model can't read pictures.")
  })

  it('no answer for the page, or pages changed meanwhile: nothing is written', async () => {
    const s = fakeSession(doc())
    const runs = new GenerationRuns()
    const controller = new AbortController()
    runs.update('s', { controller })
    await explainSelection(s, fakeGenerator(() => 'not json').gen, { page: 1, text: 'x' }, { runs, pictures: true, controller })
    expect(runs.get('s')?.message).toBe('No explanation came back for the selection.')

    const c2 = new AbortController()
    runs.update('s', { controller: c2 })
    const changing = fakeGenerator(() => {
      s.pages = identityPages(2) as PageEntry[]
      return JSON.stringify({ page: 2, text: 'late' })
    })
    await explainSelection(s, changing.gen, { page: 1, text: 'x' }, { runs, pictures: true, controller: c2 })
    expect(runs.get('s')?.message).toMatch(/pages changed/)
    expect(s.addGenerated).not.toHaveBeenCalled()
  })
})

describe('selection helpers', () => {
  it('textInRect keeps the items starting inside the rect, in any corner order', () => {
    expect(textInRect(doc()[1] as never, [300, 450, 50, 350])).toBe('E = mc^2')
  })

  it('labels and appends', () => {
    expect(selectionLabel({ page: 0, rect: [0, 0, 1, 1] })).toBe('On the selected area')
    expect(selectionLabel({ page: 0, text: 'a  very '.repeat(10) })).toMatch(/^On "a very a very .{0,30}…"$/)
    expect(appended(undefined, 'L', ' x ')).toBe('L: x')
    expect(appended('Old.  ', 'L', 'x')).toBe('Old.\n\nL: x')
  })

  it('areaCrop adds a margin, stays on the page and enlarges small areas up to 4x', () => {
    const small = areaCrop([100, 100, 150, 120], 600, 800)
    expect(small.scale).toBe(4)
    expect(small.x).toBeCloseTo(97)
    expect(small.w).toBeCloseTo(56)
    const edge = areaCrop([0, 0, 600, 800], 600, 800)
    expect([edge.x, edge.y, edge.w, edge.h]).toEqual([0, 0, 600, 800])
    expect(edge.scale).toBeCloseTo(1280 / 800)
  })

  it('the prompt names the attached picture for Codex in its own words', () => {
    const p = selectionPrompt({ page: 3, kind: 'area', text: '', picture: true, context: [{ page: 3, text: 'x' }], total: 9, note: 'codex' })
    expect(p).toContain('Document text (pages 3 of 9, for context)')
    expect(p).toContain('The attached picture shows the selected area of page 3.')
    expect(p).toContain('{"page": 3, "text": "<explanation>"}')
  })
})
