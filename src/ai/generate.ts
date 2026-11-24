/**
 * One explanation generation for a document, in two phases. Preparing: read
 * the text of every page (pdf.js text content, as search and the text layer
 * use; the whole document goes along as context) and decide for each page to
 * explain whether it is empty, plain text or gets a picture (operator lists
 * only, nothing rendered). Running: cut the pages into as few requests as
 * possible, render each request's pictures right before it is sent, and set
 * each explanation as its line streams in, with whichever generator the user
 * chose (see generator.ts). Load it on demand: nothing here (pictures
 * included) needs to run or load while explanations are not being generated.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import type { DocumentSession } from '../core/session/session.svelte'
import type { PageEntry } from '../core/session/pages'
import { textContentOf } from '../core/viewer/textContent'
import { toasts } from '../ui/toasts.svelte'
import { chunkPlanned, contextFor, DEFAULT_LIMITS, type ChunkLimits, type PlannedPage } from './chunking'
import { isAppError } from '../core/ipc/api'
import type { ExplanationGenerator } from './generator'
import { parseAnswerLine } from './parse'
import { renderPicture, type PagePicture } from './pictures/render'
import { classifyPage, pageShape, type PageKind } from './pictures/select'
import { cleanPageText, SYSTEM_PROMPT, userPrompt, type PageText } from './prompt'
import { retryPages } from './retry'
import { generationRuns, type GenerationRuns } from './runs.svelte'

/** Pages read at once while preparing. */
const READ_BATCH = 8
/** Pictures rendered at once (each holds a full-size canvas while it renders). */
const RENDER_BATCH = 4

/** The session parts a generation uses (a DocumentSession). */
export type GenerationTarget = Pick<
  DocumentSession,
  'id' | 'doc' | 'pages' | 'noTextPages' | 'setNoTextPages' | 'addGenerated' | 'endGenerated'
>

/** The text of a file page (empty for a page without text, e.g. a scan). */
async function textOf(page: PDFPageProxy): Promise<string> {
  const { items } = await textContentOf(page)
  return items
    .map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : ''))
    .join('')
    .trim()
}

/** What preparing found: every page's text, the pages to explain, and the file pages that get the "no text" note. */
interface Prepared {
  /** Every page of the document in order ('' for a page without text), for context. */
  texts: PageText[]
  /** The pages to explain, in page order, with whether each gets a picture. */
  planned: PlannedPage[]
  noText: PageEntry[]
}

interface PrepareOptions {
  mode: 'useful' | 'all'
  /** Whether pictures can be sent at all (see ExplanationGenerator.pictures). */
  pictures: boolean
  signal: AbortSignal
  /** Pages read so far, after each batch. */
  onProgress(done: number): void
}

/**
 * Reads the text of every page and, for the pages `indices`, what each one
 * is. Empty pages (no text, no image, next to no drawing) are not explained
 * and get the "no text" note; so does a page without text when pictures
 * can't be sent, since nothing of it would reach the model. Inserted empty
 * pages are neither explained nor noted.
 */
async function preparePages(session: GenerationTarget, indices: readonly number[], options: PrepareOptions): Promise<Prepared> {
  const pages = session.pages
  const explain = new Set(indices)
  const texts: PageText[] = []
  const planned: PlannedPage[] = []
  const noText: PageEntry[] = []

  /**
   * One page: its text, its cleaned text length, and what it is when it is
   * to be explained (null: just context).
   */
  async function prepare(i: number): Promise<{ text: string; length: number; kind: PageKind | null }> {
    const entry = pages[i]
    if (entry.kind !== 'source') return { text: '', length: 0, kind: null }
    const page = await session.doc.getPage(entry.source + 1)
    const text = await textOf(page)
    const length = cleanPageText(text).length
    if (!explain.has(i)) return { text, length, kind: null }
    // Without pictures only "empty or not" matters, and a page with text is
    // never empty: its operator list need not be read.
    if (!options.pictures && length > 0) return { text, length, kind: 'text' }
    try {
      return { text, length, kind: classifyPage(options.mode, length, await pageShape(page)) }
    } catch (e) {
      // One unreadable page must not stop the run (a Retry would only hit
      // it again): with pictures it gets one, as its picture may still
      // render; without, it is a text page, or empty when it has no text.
      console.warn(`Could not analyze page ${i + 1}`, e)
      return { text, length, kind: options.pictures ? 'picture' : length > 0 ? 'text' : 'empty' }
    }
  }

  for (let k = 0; k < pages.length && !options.signal.aborted; k += READ_BATCH) {
    const batch = pages.slice(k, k + READ_BATCH).map((_, j) => k + j)
    const read = await Promise.all(batch.map(prepare))
    batch.forEach((i, j) => {
      const { text, length, kind } = read[j]
      texts.push({ page: i + 1, text })
      if (kind === null) return
      const picture = options.pictures && kind === 'picture'
      if (kind === 'empty' || (length === 0 && !picture)) noText.push(pages[i])
      else planned.push({ page: i + 1, text, picture })
    })
    options.onProgress(k + batch.length)
  }
  return { texts, planned, noText }
}

/** A chunk's rendered pictures, and how many of its pictures could not be made. */
interface Rendered {
  pictures: PagePicture[]
  failed: number
}

/**
 * The pictures of `chunk`'s pictured pages, in page order, rendered a few at
 * a time from the page entries the run started with; `onBatch` gets the
 * count rendered so far after each batch. Stops between batches once
 * `signal` aborts (the caller then sends nothing). A page whose picture
 * fails is sent without one (as text, or left to Retry when it has none):
 * one broken page must not stop the run, or every Retry would hit it again.
 */
async function renderPictures(
  session: GenerationTarget,
  entries: readonly PageEntry[],
  chunk: readonly PlannedPage[],
  signal: AbortSignal,
  onBatch: (done: number) => void,
): Promise<Rendered> {
  const pictured = chunk.filter((p) => p.picture)
  const out: PagePicture[] = []
  let failed = 0
  const one = (p: PlannedPage) =>
    renderPicture(session.doc, entries[p.page - 1], p.page).catch((e) => {
      console.warn(`Could not render the picture of page ${p.page}`, e)
      return null
    })
  for (let k = 0; k < pictured.length && !signal.aborted; k += RENDER_BATCH) {
    const batch = await Promise.all(pictured.slice(k, k + RENDER_BATCH).map(one))
    for (const picture of batch) {
      if (picture) out.push(picture)
      else failed++
    }
    onBatch(k + batch.length)
  }
  return { pictures: out, failed }
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

/** A user-facing message for an error a generator rejected with (generators give readable messages). */
export function describeError(e: unknown): string {
  if (isAppError(e)) return e.message
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

export interface GenerateOptions {
  /** Page indices to explain (Retry); default: every page. */
  pages?: readonly number[]
  limits?: ChunkLimits
  /** Which pages get a picture (when the generator can send pictures); default 'useful'. */
  pictures?: 'useful' | 'all'
  runs?: GenerationRuns
  now?: () => string
  /**
   * The controller of a run the caller already shows as 'preparing' (see
   * startGeneration.ts: loading this code and a model lookup come first);
   * default: a new run.
   */
  controller?: AbortController
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
  const limits = options.limits ?? DEFAULT_LIMITS
  const id = session.id
  const controller = options.controller ?? new AbortController()
  if (runs.isActive(id) && runs.get(id)?.controller !== controller) return
  const signal = controller.signal
  const pagesAtStart = session.pages
  runs.update(id, { status: 'preparing', done: 0, total: pagesAtStart.length, message: null, retry: [], controller, pictures: null })
  // The run was forgotten while going (its tab closed and cancelled it): the
  // session is disposed, so nothing more is written into it or reported.
  const forgotten = () => runs.get(id)?.controller !== controller
  const stop = (message: string, retry: number[] = []) => {
    if (forgotten()) return
    runs.update(id, { status: 'stopped', message, retry, controller: null, pictures: null })
  }

  // A Retry explains only its pages but still reads every page for context.
  const indices = options.pages ?? pagesAtStart.map((_, i) => i)
  let prepared: Prepared
  try {
    prepared = await preparePages(session, indices, {
      mode: options.pictures ?? 'useful',
      pictures: generator.pictures,
      signal,
      onProgress: (done) => {
        if (!forgotten()) runs.update(id, { done })
      },
    })
  } catch (e) {
    console.error('Could not prepare the pages', e)
    return stop(`The pages could not be prepared: ${describeError(e)}`)
  }
  if (signal.aborted) return stop('Cancelled.')
  if (!samePages(pagesAtStart, session.pages)) return stop('Stopped: the pages changed while their text was read.')
  // A full run replaces the notes; a retry adds to them.
  session.setNoTextPages(options.pages ? [...session.noTextPages, ...prepared.noText] : prepared.noText)
  const { texts, planned } = prepared
  if (planned.length === 0) {
    return stop(
      generator.pictures
        ? 'No page has text or a picture to explain (the pages are empty).'
        : "No page has text to explain, and this model can't read pictures.",
    )
  }

  const wanted = planned.map((p) => p.page - 1)
  const arrived = new Set<number>()
  let truncated = false
  let pagesChanged = false
  let error: unknown = null
  // Pictures that could not be made, in the chunks that were sent.
  let failedPictures = 0
  runs.update(id, { status: 'running', done: 0, total: wanted.length })
  session.endGenerated()
  const chunks = chunkPlanned(planned, limits)
  // Rendering stops on Cancel, and also as soon as the loop ends early
  // (cut off, failed, pages changed): no pictures for a chunk never sent.
  const rendering = new AbortController()
  signal.addEventListener('abort', () => rendering.abort(), { once: true })
  // Pictures of a chunk need rendering only when the generator sends them.
  const picturedIn = (k: number) => (generator.pictures ? chunks[k].filter((p) => p.picture).length : 0)
  // Pictures rendered so far per chunk, and the chunk the loop is waiting
  // for: only that one shows "Preparing pictures" (the next chunk renders
  // ahead while "Explaining" shows).
  const renderedOf: number[] = chunks.map(() => 0)
  let waitingFor = -1
  const showPictures = (k: number) => {
    if (!forgotten()) runs.update(id, { pictures: { done: renderedOf[k], total: picturedIn(k) } })
  }
  const picturesOf = (k: number): Promise<Rendered> => {
    const onBatch = (done: number) => {
      renderedOf[k] = done
      if (waitingFor === k) showPictures(k)
    }
    const p = picturedIn(k) > 0
      ? renderPictures(session, pagesAtStart, chunks[k], rendering.signal, onBatch)
      : Promise.resolve({ pictures: [], failed: 0 })
    // Rendered ahead while the previous request runs: a failure is reported
    // when its chunk is due (or not at all once the run has ended).
    p.catch(() => {})
    return p
  }
  try {
    let next = picturesOf(0)
    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k]
      // Rendering may still be under way (always for the first chunk): say so.
      const waiting = picturedIn(k) > renderedOf[k]
      if (waiting) {
        waitingFor = k
        showPictures(k)
      }
      const { pictures: images, failed } = await next
      if (waiting) {
        waitingFor = -1
        if (!forgotten()) runs.update(id, { pictures: null })
      }
      if (signal.aborted) break
      failedPictures += failed
      if (!samePages(pagesAtStart, session.pages)) {
        pagesChanged = true
        break
      }
      // The next chunk's pictures render while this request runs; this
      // chunk's pictures are dropped once it has been sent.
      if (k + 1 < chunks.length) next = picturesOf(k + 1)
      const expected = new Set(chunk.map((p) => p.page))
      const user = userPrompt({
        explain: chunk.map(({ page, text }) => ({ page, text })),
        context: contextFor(texts, chunk, limits.maxInputChars),
        total: pagesAtStart.length,
        pictures: images.map((i) => i.page),
        note: generator.pictureNote,
      })
      const outcome = await generator.generate(
        { system: SYSTEM_PROMPT, user, images },
        (line) => {
          if (forgotten()) return
          const parsed = parseAnswerLine(line)
          if (!parsed || !expected.has(parsed.page)) return
          // Page numbers must still name the pages they were sent for.
          if (!samePages(pagesAtStart, session.pages)) {
            pagesChanged = true
            controller.abort()
            return
          }
          const i = parsed.page - 1
          session.addGenerated(i, { text: parsed.text, model: generator.model, createdAt: now() })
          arrived.add(i)
          runs.update(id, { done: arrived.size })
        },
        signal,
      )
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
    rendering.abort()
    session.endGenerated()
  }

  if (forgotten()) return
  if (pagesChanged) return stop('Stopped: the pages changed while generating. Start again to explain the rest.')
  const missing = retryPages(wanted, arrived)
  if (missing.length === 0 && !error) {
    runs.clear(id)
    toasts.show(`Explanations added for ${plural(arrived.size, 'page', 'pages')}`)
    return
  }
  const kept = arrived.size > 0 ? ` ${plural(arrived.size, 'page was', 'pages were')} explained.` : ''
  const why = error
    ? describeError(error)
    : signal.aborted
      ? 'Cancelled.'
      : truncated
        ? 'The answer was cut off (the model reached its output limit).'
        : `${plural(missing.length, 'page got', 'pages got')} no explanation.`
  const broken = failedPictures > 0 ? ` (${plural(failedPictures, 'page picture', 'page pictures')} could not be made.)` : ''
  stop(`${why}${kept}${broken}`, missing)
}
