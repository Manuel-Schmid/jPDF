import { describe, expect, it, vi } from 'vitest'
import { generateExplanations, samePages, type GenerationTarget } from '../../src/ai/generate'
import type { ExplanationGenerator, GenerationRequest } from '../../src/ai/generator'
import { GenerationRuns } from '../../src/ai/runs.svelte'
import type { Explanation } from '../../src/core/session/model'
import { identityPages, type PageEntry } from '../../src/core/session/pages'

/** A session whose file pages have `texts` (empty string: no text, like a scan). */
function fakeSession(texts: string[]) {
  const pdfPages = texts.map((t) => ({
    getTextContent: async () => ({ items: t ? [{ str: t, hasEOL: false }] : [] }),
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

function fakeGenerator(script: Script) {
  const requests: GenerationRequest[] = []
  const gen: ExplanationGenerator = {
    model: 'test-model',
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

const run = (s: GenerationTarget, gen: ExplanationGenerator, runs: GenerationRuns, pages?: number[]) =>
  generateExplanations(s, gen, { runs, pages, now: () => 'T', busyRetryDelays: [0, 0] })

const busy = { code: 'AiUnavailable', message: 'HTTP 503: The model is overloaded.' }

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
    const s = fakeSession(Array.from({ length: 150 }, (_, i) => `Slide ${i + 1}`))
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
      throw { code: 'AiNetwork', message: 'connection reset' }
    })
    await run(s, gen, runs)
    expect(s.explanations.map((e) => e?.text ?? null)).toEqual(['one', 'two', null, null])
    const stopped = runs.get(s.id)!
    expect(stopped.status).toBe('stopped')
    expect(stopped.retry).toEqual([2, 3])
    expect(stopped.message).toMatch(/could not be reached: connection reset/)
    expect(stopped.message).toMatch(/2 pages were explained/)

    const retry = fakeGenerator(answerAll)
    await run(s, retry.gen, runs, stopped.retry)
    expect(retry.requests[0].user).toContain('pages 3, 4 of 4')
    expect(retry.requests[0].user).not.toContain('=== Page 1 ===')
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

  it('maps key and quota errors to clear messages', async () => {
    for (const [code, re] of [['AiKey', /API key/], ['AiRateLimit', /rate limit or free quota/]] as const) {
      const s = fakeSession(['a'])
      const runs = new GenerationRuns()
      const { gen } = fakeGenerator(async () => {
        throw { code, message: 'HTTP 4xx' }
      })
      await run(s, gen, runs)
      expect(runs.get(s.id)!.message).toMatch(re)
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

describe('a busy provider (HTTP 502-504)', () => {
  it('retries automatically and then succeeds', async () => {
    const s = fakeSession(['a', 'b'])
    const runs = new GenerationRuns()
    let calls = 0
    const { gen, requests } = fakeGenerator(async (req, onLine, signal) => {
      if (++calls === 1) throw busy
      return answerAll(req, onLine, signal)
    })
    await run(s, gen, runs)
    expect(requests).toHaveLength(2)
    expect(s.explanations.map((e) => e?.text)).toEqual(['Explains 1', 'Explains 2'])
    expect(runs.get(s.id)).toBeUndefined()
  })

  it('a retry asks only for the pages that have not arrived', async () => {
    const s = fakeSession(['a', 'b', 'c'])
    const runs = new GenerationRuns()
    let calls = 0
    const { gen, requests } = fakeGenerator(async (req, onLine, signal) => {
      if (++calls === 1) {
        onLine('{"page": 1, "text": "one"}')
        throw busy
      }
      return answerAll(req, onLine, signal)
    })
    await run(s, gen, runs)
    expect(requests[1].user).toContain('pages 2, 3 of 3')
    expect(requests[1].user).not.toContain('=== Page 1 ===')
    expect(s.explanations.map((e) => e?.text)).toEqual(['one', 'Explains 2', 'Explains 3'])
  })

  it('gives up after the retries with a clear message and offers Retry', async () => {
    const s = fakeSession(['a'])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(async () => {
      throw busy
    })
    await run(s, gen, runs)
    expect(requests).toHaveLength(3)
    expect(runs.get(s.id)).toMatchObject({ status: 'stopped', retry: [0], note: null })
    expect(runs.get(s.id)!.message).toMatch(/busy right now/)
  })

  it('does not retry other errors', async () => {
    const s = fakeSession(['a'])
    const runs = new GenerationRuns()
    const { gen, requests } = fakeGenerator(async () => {
      throw { code: 'AiService', message: 'HTTP 404: model not found' }
    })
    await run(s, gen, runs)
    expect(requests).toHaveLength(1)
  })

  it('shows the wait in the status and stops waiting when cancelled', async () => {
    const s = fakeSession(['a'])
    const runs = new GenerationRuns()
    const notes: (string | null)[] = []
    const { gen, requests } = fakeGenerator(async () => {
      throw busy
    })
    const running = generateExplanations(s, gen, { runs, busyRetryDelays: [60_000] })
    await vi.waitFor(() => expect(runs.get(s.id)?.note).toMatch(/Provider busy, retrying in 60 s/))
    notes.push(runs.get(s.id)!.note)
    runs.cancel(s.id)
    await running
    expect(requests).toHaveLength(1)
    expect(runs.get(s.id)!.message).toMatch(/Cancelled/)
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
