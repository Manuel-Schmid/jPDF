import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIMITS } from '../../src/ai/chunking'
import { generateExplanations, samePages, type GenerateOptions, type GenerationTarget } from '../../src/ai/generate'
import type { ExplanationGenerator, GenerationRequest } from '../../src/ai/generator'
import { GenerationRuns } from '../../src/ai/runs.svelte'
import type { Explanation } from '../../src/core/session/model'
import { identityPages, type PageEntry } from '../../src/core/session/pages'

type Shape = { imageCoverage: number; paths: number }

// Page shapes come from each fake page's `shape` (default: nothing drawn), and
// pictures are rendered as `img<page>`: no real pdf.js or canvas involved.
const { pageShape, renderPicture } = vi.hoisted(() => ({
  pageShape: vi.fn(async (page: { shape?: Shape }) => page.shape ?? { imageCoverage: 0, paths: 0 }),
  renderPicture: vi.fn(async (_doc: unknown, _entry: unknown, page: number) => ({
    page,
    mediaType: 'image/jpeg' as const,
    data: `img${page}`,
  })),
}))
vi.mock('../../src/ai/pictures/select', async (orig) => ({
  ...(await orig<typeof import('../../src/ai/pictures/select')>()),
  pageShape,
}))
vi.mock('../../src/ai/pictures/render', () => ({ renderPicture }))

beforeEach(() => {
  pageShape.mockClear()
  renderPicture.mockClear()
})

/** Enough text that the page needs no picture in 'useful' mode. */
const LONG = 'Long slide text. '.repeat(20)
const IMAGE: Shape = { imageCoverage: 1, paths: 0 }

/**
 * A session whose file pages have `texts` (empty string: no text, like a
 * scan) and `shapes` (by index; default: nothing drawn). `onText` runs as a
 * page's text is read.
 */
function fakeSession(texts: string[], shapes: Record<number, Shape> = {}, onText?: (page: number) => void) {
  const pdfPages = texts.map((t, i) => ({
    shape: shapes[i],
    getTextContent: async () => {
      onText?.(i + 1)
      return { items: t ? [{ str: t, hasEOL: false }] : [] }
    },
  }))
  const s = {
    id: 'session-1',
    doc: { getPage: async (n: number) => pdfPages[n - 1] },
    pages: identityPages(texts.length) as PageEntry[],
    noTextPages: new Set<PageEntry>() as ReadonlySet<PageEntry>,
    explanations: texts.map(() => null) as (Explanation | null)[],
    setNoTextPages(entries: Iterable<PageEntry>) {
      s.noTextPages = new Set(entries)
    },
    addGenerated: vi.fn((i: number, e: Explanation) => {
      s.explanations[i] = e
    }),
    endGenerated: vi.fn(),
  }
  return s as typeof s & GenerationTarget
}

type Script = (req: GenerationRequest, onLine: (l: string) => void, signal: AbortSignal) => Promise<'done' | 'truncated' | 'cancelled'>

function fakeGenerator(script: Script, pictures = true) {
  const requests: GenerationRequest[] = []
  const gen: ExplanationGenerator = {
    model: 'test-model',
    pictureNote: 'claude',
    pictures,
    generate: (req, onLine, signal) => {
      requests.push(req)
      return script(req, onLine, signal)
    },
  }
  return { gen, requests }
}

/** Answers every page named in the prompt ("=== Page N ==="), one line each. */
const answerAll: Script = async (req, onLine) => {
  for (const m of req.user.matchAll(/=== Page (\d+) ===/g)) onLine(JSON.stringify({ page: Number(m[1]), text: `Explains ${m[1]}` }))
  return 'done'
}

const run = (
  s: GenerationTarget,
  gen: ExplanationGenerator,
  runs: GenerationRuns,
  pages?: number[],
  more: GenerateOptions = {},
) => generateExplanations(s, gen, { runs, pages, now: () => 'T', ...more })

const imagePages = (req: GenerationRequest) => req.images.map((i) => i.page)

describe('generateExplanations', () => {
  it('explains every page with text in one request and marks pages without text', async () => {
    const s = fakeSession(['Intro', '', 'Cells'])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(requests).toHaveLength(1)
    expect(requests[0].user).not.toContain('=== Page 2 ===')
    expect(s.explanations).toEqual([
      { text: 'Explains 1', model: 'test-model', createdAt: 'T' },
      null,
      { text: 'Explains 3', model: 'test-model', createdAt: 'T' },
    ])
    expect([...s.noTextPages]).toEqual([s.pages[1]])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('uses exactly one request for 150 pages and fills them page by page as lines arrive', async () => {
    // Text-rich pages (no pictures): pictured pages are capped at 40 per request.
    const s = fakeSession(Array.from({ length: 150 }, (_, i) => `Slide ${i + 1} ${LONG}`))
    const runs = new GenerationRuns()
    const progress: number[] = []
    const { gen, requests } = fakeGenerator(async (req, onLine) => {
      for (let p = 1; p <= 150; p++) {
        onLine(JSON.stringify({ page: p, text: `t${p}` }))
        progress.push(runs.get(s.id)!.done)
      }
      return 'done'
    })
    await run(s, gen, runs)
    expect(requests).toHaveLength(1)
    expect(progress.slice(0, 3)).toEqual([1, 2, 3])
    expect(s.addGenerated).toHaveBeenCalledTimes(150)
  })

  it('ignores broken lines and pages that were not asked for', async () => {
    const s = fakeSession(['a', 'b'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine) => {
      onLine('```json')
      onLine('{"page": 1, "text": "ok"}')
      onLine('{"page": 9, "text": "not a page"}')
      onLine('{"page": 2, "text": "cut')
      return 'done'
    })
    await run(s, gen, runs)
    expect(s.explanations.map((e) => e?.text ?? null)).toEqual(['ok', null])
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', retry: [1] })
  })

  it('keeps the pages that arrived when the stream breaks, and Retry continues from the first missing page', async () => {
    const s = fakeSession(['a', 'b', 'c', 'd'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine) => {
      onLine('{"page": 1, "text": "one"}')
      onLine('{"page": 2, "text": "two"}')
      throw new Error('The connection broke: connection reset')
    })
    await run(s, gen, runs)
    expect(s.explanations.map((e) => e?.text ?? null)).toEqual(['one', 'two', null, null])
    const stopped = runs.get(s.id)!
    expect(stopped.status).toBe('stopped')
    expect(stopped.retry).toEqual([2, 3])
    expect(stopped.message).toMatch(/connection reset/)
    expect(stopped.message).toMatch(/2 pages were explained/)

    const retry = fakeGenerator(answerAll)
    await run(s, retry.gen, runs, stopped.retry)
    expect(retry.requests[0].user).toContain('Explain pages 3–4 of this document')
    // A Retry still sends the whole document's text for context.
    expect(retry.requests[0].user).toContain('Document text (all 4 pages, for context)')
    expect(s.explanations.map((e) => e?.text ?? null)).toEqual(['one', 'two', 'Explains 3', 'Explains 4'])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('cancelling keeps what arrived and offers the rest', async () => {
    const s = fakeSession(['a', 'b', 'c'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine, signal) => {
      onLine('{"page": 1, "text": "one"}')
      runs.cancel(s.id)
      onLine('{"page": 2, "text": "late"}')
      return signal.aborted ? 'cancelled' : 'done'
    })
    await run(s, gen, runs)
    // Lines after the abort may still reach the callback; the generator drops them in real use.
    expect(s.explanations[0]?.text).toBe('one')
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped' })
    expect(runs.get(s.id)!.message).toMatch(/Cancelled/)
    expect(runs.get(s.id)!.retry).toContain(2)
  })

  it('a run forgotten while going (its tab closed) writes and reports nothing more', async () => {
    const s = fakeSession(['a', 'b', 'c'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine) => {
      onLine('{"page": 1, "text": "one"}')
      // What closing the tab does.
      runs.cancel(s.id)
      runs.clear(s.id)
      onLine('{"page": 2, "text": "late"}')
      return 'cancelled'
    })
    await run(s, gen, runs)
    expect(s.addGenerated).toHaveBeenCalledOnce()
    expect(s.explanations[1]).toBeNull()
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('reports a cut-off answer and offers the missing pages', async () => {
    const s = fakeSession(['a', 'b'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine) => {
      onLine('{"page": 1, "text": "one"}')
      return 'truncated'
    })
    await run(s, gen, runs)
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', retry: [1] })
    expect(runs.get(s.id)!.message).toMatch(/cut off/)
  })

  it("shows the generator's error message and offers Retry", async () => {
    for (const error of [new Error('Claude Desktop is not connected'), { message: 'Plan limit reached' }, 'timed out']) {
      const s = fakeSession(['a'])
      const runs = new GenerationRuns()
      const { gen } = fakeGenerator(async () => {
        throw error
      })
      await run(s, gen, runs)
      const text = typeof error === 'string' ? error : error.message
      expect(runs.get(s.id)!.message).toContain(text)
      expect(runs.get(s.id)!.retry).toEqual([0])
    }
  })

  it('stops when the pages change while streaming (page numbers would name other pages)', async () => {
    const s = fakeSession(['a', 'b', 'c'])
    const runs = new GenerationRuns()
    const { gen } = fakeGenerator(async (_req, onLine) => {
      onLine('{"page": 1, "text": "one"}')
      s.pages = s.pages.slice(1)
      onLine('{"page": 2, "text": "two"}')
      return 'done'
    })
    await run(s, gen, runs)
    expect(s.addGenerated).toHaveBeenCalledTimes(1)
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', retry: [] })
    expect(runs.get(s.id)!.message).toMatch(/pages changed/)
  })

  it('stops without a request when no page has text', async () => {
    const s = fakeSession(['', ''])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(requests).toHaveLength(0)
    expect(s.noTextPages.size).toBe(2)
    expect(runs.get(s.id)!.message).toMatch(/No page has text/)
  })

  it('does not start a second run while one is active', async () => {
    const s = fakeSession(['a'])
    const runs = new GenerationRuns()
    let release!: () => void
    const { gen, requests } = fakeGenerator(
      () => new Promise((r) => (release = () => r('done'))),
    )
    const first = run(s, gen, runs)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await run(s, gen, runs)
    expect(requests).toHaveLength(1)
    release()
    await first
  })
})

describe('generateExplanations with pictures', () => {
  it('scanned page is explained from its picture', async () => {
    const s = fakeSession([LONG, ''], { 1: IMAGE })
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(requests).toHaveLength(1)
    expect(requests[0].images).toEqual([{ page: 2, mediaType: 'image/jpeg', data: 'img2' }])
    expect(requests[0].user).toContain('=== Page 2 ===\n(no text; see its picture)')
    expect(requests[0].user).toContain('Picture of page 2 is attached.')
    expect(s.noTextPages.size).toBe(0)
    expect(s.explanations[1]?.text).toBe('Explains 2')
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('empty page keeps the no-text note and is not sent', async () => {
    const s = fakeSession([LONG, ''])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(requests[0].images).toEqual([])
    expect(requests[0].user).not.toContain('=== Page 2 ===')
    expect([...s.noTextPages]).toEqual([s.pages[1]])
    expect(renderPicture).not.toHaveBeenCalled()
  })

  it("pictures only for the chunk's pages", async () => {
    const s = fakeSession(['a', 'b', LONG, 'd'])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs, undefined, { limits: { ...DEFAULT_LIMITS, maxPages: 2 } })
    expect(requests).toHaveLength(2)
    expect(imagePages(requests[0])).toEqual([1, 2])
    // Page 3 has enough text and draws nothing: no picture.
    expect(imagePages(requests[1])).toEqual([4])
    expect(renderPicture).toHaveBeenCalledTimes(3)
    expect(s.explanations.every((e) => e !== null)).toBe(true)
  })

  it('every non-empty page gets a picture in "all" mode', async () => {
    const s = fakeSession([LONG, '', LONG])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs, undefined, { pictures: 'all' })
    expect(imagePages(requests[0])).toEqual([1, 3])
    expect([...s.noTextPages]).toEqual([s.pages[1]])
  })

  it('generator without picture support renders nothing', async () => {
    const s = fakeSession(['a', '', ''], { 1: IMAGE })
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll, false)
    await run(s, gen, runs)
    expect(renderPicture).not.toHaveBeenCalled()
    expect(requests[0].images).toEqual([])
    expect(requests[0].user).not.toContain('see its picture')
    // Only pages without text can be empty: shapes are read for those alone.
    expect(pageShape).toHaveBeenCalledTimes(2)
    // The scan cannot be explained without its picture, so it keeps the note too.
    expect([...s.noTextPages]).toEqual([s.pages[1], s.pages[2]])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('retry sends full context and lists scattered pages', async () => {
    const s = fakeSession(Array.from({ length: 6 }, (_, i) => `Slide ${i + 1} ${LONG}`))
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs, [1, 4])
    expect(requests).toHaveLength(1)
    const user = requests[0].user
    expect(user).toContain('Document text (all 6 pages, for context)')
    expect(user).toContain('=== Page 1 ===')
    expect(user).toContain('=== Page 6 ===')
    expect(user).toContain('Explain pages 2, 5 of this document (one JSON line per page: 2 lines).')
    // Every page is read for its text, but shapes only for the pages to explain.
    expect(pageShape).toHaveBeenCalledTimes(2)
    expect(s.explanations.map((e) => e !== null)).toEqual([false, true, false, false, true, false])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('cancel while preparing sends nothing', async () => {
    const runs = new GenerationRuns()
    const s = fakeSession(['a', 'b'], {}, () => runs.cancel('session-1'))
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(requests).toHaveLength(0)
    expect(renderPicture).not.toHaveBeenCalled()
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', message: 'Cancelled.' })
  })

  it('cancel while rendering a chunk sends nothing more', async () => {
    const s = fakeSession(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    const runs = new GenerationRuns()
    renderPicture.mockImplementationOnce(async (_doc, _entry, page) => {
      runs.cancel(s.id)
      return { page, mediaType: 'image/jpeg', data: 'x' }
    })
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs, undefined, { limits: { ...DEFAULT_LIMITS, maxPages: 5 } })
    expect(requests).toHaveLength(0)
    // The batch under way finishes; no later batch or chunk starts.
    expect(renderPicture.mock.calls.length).toBeLessThanOrEqual(4)
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped' })
    expect(runs.get(s.id)!.message).toMatch(/Cancelled/)
    expect(runs.get(s.id)!.retry).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('preparing status counts pages', async () => {
    const s = fakeSession(Array.from({ length: 10 }, (_, i) => `Slide ${i + 1}`))
    const runs = new GenerationRuns()
    const seen: string[] = []
    const update = runs.update.bind(runs)
    runs.update = (id, patch) => {
      update(id, patch)
      const r = runs.get(id)!
      if (r.status === 'preparing') seen.push(`preparing ${r.done}/${r.total}`)
    }
    const { gen } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(seen).toEqual(['preparing 0/10', 'preparing 8/10', 'preparing 10/10'])
  })

  it('a picture that cannot be rendered is left out and the page goes as text', async () => {
    const s = fakeSession(['a', 'b'])
    const runs = new GenerationRuns()
    renderPicture.mockRejectedValueOnce(new Error('broken page'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    warn.mockRestore()
    expect(requests).toHaveLength(1)
    expect(imagePages(requests[0])).toEqual([2])
    expect(requests[0].user).toContain('=== Page 1 ===\na')
    expect(s.explanations.every((e) => e !== null)).toBe(true)
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('a page that cannot be analyzed gets a picture instead of stopping the run', async () => {
    const s = fakeSession([LONG, LONG])
    const runs = new GenerationRuns()
    pageShape.mockRejectedValueOnce(new Error('bad operators'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    warn.mockRestore()
    expect(requests).toHaveLength(1)
    expect(imagePages(requests[0])).toEqual([1])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('without pictures, a page that cannot be analyzed and has no text counts as empty', async () => {
    const s = fakeSession(['a', ''])
    const runs = new GenerationRuns()
    pageShape.mockRejectedValueOnce(new Error('bad operators'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gen, requests } = fakeGenerator(answerAll, false)
    await run(s, gen, runs)
    warn.mockRestore()
    expect(requests).toHaveLength(1)
    expect([...s.noTextPages]).toEqual([s.pages[1]])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('a run that stops early renders no more pictures for the next chunk', async () => {
    const s = fakeSession(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(async () => 'truncated')
    await run(s, gen, runs, undefined, { limits: { ...DEFAULT_LIMITS, maxPages: 5 } })
    // Let the batch already rendering ahead (pages 6–9) finish.
    await new Promise((r) => setTimeout(r, 0))
    expect(requests).toHaveLength(1)
    expect(renderPicture.mock.calls.map((c) => c[2])).not.toContain(10)
    expect(runs.get(s.id)!.message).toMatch(/cut off/)
  })

  it('shows "Preparing pictures" while the first request pictures render, one update per batch', async () => {
    const s = fakeSession(Array.from({ length: 6 }, () => ''), Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i, IMAGE])))
    const runs = new GenerationRuns()
    const seen: string[] = []
    const update = runs.update.bind(runs)
    runs.update = (id, patch) => {
      update(id, patch)
      const p = runs.get(id)!.pictures
      if ('pictures' in patch && runs.get(id)!.status === 'running') seen.push(p ? `${p.done}/${p.total}` : 'none')
    }
    const { gen } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    expect(seen).toEqual(['0/6', '4/6', '6/6', 'none'])
  })

  it('pictures rendered ahead for the next request show no progress over "Explaining"', async () => {
    const s = fakeSession(Array.from({ length: 10 }, (_, i) => `p${i}`))
    const runs = new GenerationRuns()
    const shown: number[] = []
    const update = runs.update.bind(runs)
    runs.update = (id, patch) => {
      update(id, patch)
      const p = runs.get(id)!.pictures
      if (p) shown.push(p.total)
    }
    // Let the second chunk finish rendering before the first request ends.
    const { gen } = fakeGenerator(async (req, onLine, signal) => {
      await new Promise((r) => setTimeout(r, 5))
      return answerAll(req, onLine, signal)
    })
    await run(s, gen, runs, undefined, { limits: { ...DEFAULT_LIMITS, maxPages: 5 } })
    // Only the first chunk was waited for (5 pictures: 0/5 and the two batches).
    expect(shown).toEqual([5, 5, 5])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('names picture failures when pages are left without an explanation', async () => {
    const s = fakeSession(['a', ''], { 1: IMAGE })
    const runs = new GenerationRuns()
    renderPicture.mockRejectedValueOnce(new Error('broken page')).mockRejectedValueOnce(new Error('broken page'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gen } = fakeGenerator(answerAll)
    await run(s, gen, runs)
    warn.mockRestore()
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', retry: [1] })
    expect(runs.get(s.id)!.message).toBe('1 page got no explanation. 1 page was explained. (2 page pictures could not be made.)')
  })

  it('a run started by the caller (already preparing) goes on with its controller', async () => {
    const s = fakeSession(['a'])
    const runs = new GenerationRuns()
    const controller = new AbortController()
    runs.update(s.id, { status: 'preparing', controller })
    const { gen, requests } = fakeGenerator(answerAll)
    await run(s, gen, runs, undefined, { controller })
    expect(requests).toHaveLength(1)
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('a page with only blank space counts as having no text', async () => {
    const s = fakeSession([LONG, '   \n  '])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(answerAll, false)
    await run(s, gen, runs)
    expect(requests[0].user).not.toContain('=== Page 2 ===')
    expect([...s.noTextPages]).toEqual([s.pages[1]])
  })
})

describe('samePages', () => {
  it('ignores rotation but not order, length or kind', () => {
    const a = identityPages(2)
    expect(samePages(a, [{ ...a[0], rotate: 90 }, a[1]])).toBe(true)
    expect(samePages(a, [a[1], a[0]])).toBe(false)
    expect(samePages(a, a.slice(1))).toBe(false)
    expect(samePages(a, [a[0], { kind: 'blank', width: 1, height: 1, rotate: 0 }])).toBe(false)
  })
})
