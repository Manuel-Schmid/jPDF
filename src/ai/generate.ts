/**
 * One explanation generation for a document: collect the pages' text (pdf.js
 * text content, as search and the text layer use), send it in as few
 * requests as possible (one for documents up to ~150 pages), and set each
 * explanation as its line streams in. Loaded on demand: nothing here runs or
 * loads while AI features are off or unused.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import type { PageEntry } from '../core/session/pages'
import { textContentOf } from '../core/viewer/textContent'
import { isAppError } from '../core/ipc/api'
import { toasts } from '../ui/toasts.svelte'
import { chunkPages, type ChunkLimits } from './chunking'
import { describeAiError as describeError } from './errors'
import type { ExplanationGenerator } from './generator'
import { parseAnswerLine } from './parse'
import { SYSTEM_PROMPT, userPrompt, type PageText } from './prompt'
import { retryPages } from './retry'
import { generationRuns, type GenerationRuns } from './runs.svelte'

/** Pages read at once while collecting text. */
const READ_BATCH = 8

/** The session parts a generation uses (a DocumentSession). */
export type GenerationTarget = Pick<
  DocumentSession,
  'id' | 'doc' | 'pages' | 'noTextPages' | 'setNoTextPages' | 'addGenerated' | 'endGenerated'
>

/** The text of one page (empty for an empty page or a page without text, e.g. a scan). */
async function pageText(session: GenerationTarget, entry: PageEntry): Promise<string> {
  if (entry.kind !== 'source') return ''
  const page = await session.doc.getPage(entry.source + 1)
  const { items } = await textContentOf(page)
  return items
    .map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : ''))
    .join('')
    .trim()
}

/**
 * The text of the pages `indices`: pages with text to explain (numbered as
 * the user sees them), and the file pages without any text ("no text" note;
 * empty pages the user inserted get no note).
 */
export async function collectTexts(
  session: GenerationTarget,
  indices: readonly number[],
  signal?: AbortSignal,
): Promise<{ texts: PageText[]; noText: PageEntry[] }> {
  const pages = session.pages
  const texts: PageText[] = []
  const noText: PageEntry[] = []
  for (let k = 0; k < indices.length && !signal?.aborted; k += READ_BATCH) {
    const batch = indices.slice(k, k + READ_BATCH).filter((i) => pages[i])
    const read = await Promise.all(batch.map((i) => pageText(session, pages[i])))
    batch.forEach((i, j) => {
      if (read[j]) texts.push({ page: i + 1, text: read[j] })
      else if (pages[i].kind === 'source') noText.push(pages[i])
    })
  }
  return { texts, noText }
}

/** Whether two page lists show the same pages in the same order (rotation aside): page numbers still mean the same pages. */
export function samePages(a: readonly PageEntry[], b: readonly PageEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]
      return p.kind === 'source' ? q.kind === 'source' && q.source === p.source : q.kind === 'blank'
    })
  )
}

export interface GenerateOptions {
  /** Page indices to explain (Retry); default: every page. */
  pages?: readonly number[]
  limits?: ChunkLimits
  runs?: GenerationRuns
  now?: () => string
  /**
   * Waits before the automatic retries of a request the provider was too
   * busy for (HTTP 502-504); one retry per entry. Default: 5 s, then 15 s.
   */
  busyRetryDelays?: readonly number[]
  /**
   * Takes over the remaining pages when the main generator is still busy
   * after its retries, or out of quota (HTTP 429). It gets the same busy
   * retries; configuration errors (key, model) never switch.
   */
  backup?: ExplanationGenerator
}

/** Default waits before retrying a request the provider was too busy for. */
export const BUSY_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000]

/** Whether `e` says the provider is overloaded or briefly down (worth retrying soon). */
export function isBusy(e: unknown): boolean {
  return isAppError(e) && e.code === 'AiUnavailable'
}

/** Whether `e` says the provider's rate limit or free quota is used up (a backup may help; waiting a few seconds won't). */
export function isRateLimited(e: unknown): boolean {
  return isAppError(e) && e.code === 'AiRateLimit'
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Generates explanations for the session's pages with `generator`. Progress
 * and the outcome are in `runs` (by session id); explanations that arrived
 * stay when it is cancelled or fails, and the run then offers Retry for the
 * missing pages. All explanations of a run are one undo step.
 */
export async function generateExplanations(
  session: GenerationTarget,
  generator: ExplanationGenerator,
  options: GenerateOptions = {},
): Promise<void> {
  const runs = options.runs ?? generationRuns
  const now = options.now ?? (() => new Date().toISOString())
  const id = session.id
  if (runs.isActive(id)) return
  const controller = new AbortController()
  const signal = controller.signal
  runs.update(id, { status: 'reading', done: 0, total: 0, message: null, retry: [], note: null, backup: null, controller })
  const stop = (message: string, retry: number[] = []) => {
    runs.update(id, { status: 'stopped', message, retry, note: null, controller: null })
  }

  const pagesAtStart = session.pages
  const indices = options.pages ?? pagesAtStart.map((_, i) => i)
  let collected: Awaited<ReturnType<typeof collectTexts>>
  try {
    collected = await collectTexts(session, indices, signal)
  } catch (e) {
    console.error('Could not read the page text', e)
    return stop(`The page text could not be read: ${describeError(e)}`)
  }
  if (signal.aborted) return stop('Cancelled.')
  if (!samePages(pagesAtStart, session.pages)) return stop('Stopped: the pages changed while their text was read.')
  // A full run replaces the notes; a retry adds to them.
  session.setNoTextPages(options.pages ? [...session.noTextPages, ...collected.noText] : collected.noText)
  const { texts } = collected
  if (texts.length === 0) return stop('No page has text to explain (scanned pages have no text).')

  const planned = texts.map((t) => t.page - 1)
  const arrived = new Set<number>()
  let truncated = false
  let pagesChanged = false
  let error: unknown = null
  /** The generator in use: the main one, or the backup once it took over (for the rest of the run). */
  let current = generator
  runs.update(id, { status: 'running', total: planned.length })
  session.endGenerated()
  try {
    const delays = options.busyRetryDelays ?? BUSY_RETRY_DELAYS_MS
    for (const chunk of chunkPages(texts, options.limits)) {
      const expected = new Set(chunk.map((p) => p.page))
      const onLine = (line: string) => {
        const parsed = parseAnswerLine(line)
        if (!parsed || !expected.has(parsed.page)) return
        // Page numbers must still name the pages they were sent for.
        if (!samePages(pagesAtStart, session.pages)) {
          pagesChanged = true
          controller.abort()
          return
        }
        const i = parsed.page - 1
        session.addGenerated(i, { text: parsed.text, model: current.model, createdAt: now() })
        arrived.add(i)
        runs.update(id, { done: arrived.size })
      }
      let outcome: Awaited<ReturnType<ExplanationGenerator['generate']>>
      for (let attempt = 0; ; attempt++) {
        // A retry asks only for the chunk's pages that have not arrived yet.
        const pending = chunk.filter((p) => !arrived.has(p.page - 1))
        if (pending.length === 0) {
          outcome = 'done'
          break
        }
        try {
          outcome = await current.generate(
            { system: SYSTEM_PROMPT, user: userPrompt(pending, session.pages.length) },
            onLine,
            signal,
          )
          break
        } catch (e) {
          if (signal.aborted) throw e
          const busy = isBusy(e)
          const canSwitch = !!options.backup && current !== options.backup
          // Out of quota, or still busy after the retries: hand the rest to the backup.
          if (canSwitch && (isRateLimited(e) || (busy && attempt >= delays.length))) {
            console.warn('The provider is busy or out of quota, switching to the backup', e)
            current = options.backup!
            runs.update(id, { backup: current.model, note: null })
            attempt = -1
            continue
          }
          if (!busy || attempt >= delays.length) throw e
          console.warn('The provider is busy, retrying', e)
          runs.update(id, { note: `Provider busy, retrying in ${Math.round(delays[attempt] / 1000)} s…` })
          await pause(delays[attempt], signal)
          runs.update(id, { note: null })
          if (signal.aborted) {
            outcome = 'cancelled'
            break
          }
        }
      }
      if (outcome === 'cancelled' || signal.aborted) break
      if (outcome === 'truncated') {
        truncated = true
        break
      }
    }
  } catch (e) {
    console.error('Explanation generation failed', e)
    error = e
  } finally {
    session.endGenerated()
  }

  if (pagesChanged) return stop('Stopped: the pages changed while generating. Start again to explain the rest.')
  const missing = retryPages(planned, arrived)
  if (missing.length === 0 && !error) {
    runs.clear(id)
    toasts.show(`Explanations added for ${plural(arrived.size, 'page', 'pages')}`)
    return
  }
  const kept = arrived.size > 0 ? ` ${plural(arrived.size, 'page was', 'pages were')} explained.` : ''
  const why = error
    ? `${current === options.backup ? 'Backup provider: ' : ''}${describeError(error)}`
    : signal.aborted
      ? 'Cancelled.'
      : truncated
        ? 'The answer was cut off (the model reached its output limit).'
        : `${plural(missing.length, 'page got', 'pages got')} no explanation.`
  stop(`${why}${kept}`, missing)
}
