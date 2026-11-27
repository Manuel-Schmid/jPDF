/**
 * "Explain this": one request about a selected area or text of a page, its
 * answer appended to that page's explanation. Loaded on demand (it reaches
 * pdf.js rendering and the generation code), like generate.ts.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { DocumentSession } from '../core/session/session.svelte'
import type { Rect } from '../core/session/model'
import { textContentOf } from '../core/viewer/textContent'
import { toasts } from '../ui/toasts.svelte'
import { describeError, samePages } from './generate'
import type { ExplanationGenerator } from './generator'
import { parseAnswerLine } from './parse'
import { renderArea, type PagePicture } from './pictures/render'
import { SYSTEM_PROMPT, selectionPrompt, type PageText } from './prompt'
import { generationRuns, type GenerationRuns } from './runs.svelte'

/** What was selected: an area (PDF user space) or text, on a 0-based page. */
export type SelectionTarget = { page: number; rect: Rect } | { page: number; text: string }

/** Pages before and after the selection's page sent along for context. */
const CONTEXT_PAGES = 2
/** How many characters of a selected text the label repeats. */
const LABEL_CHARS = 40

export type SelectionSession = Pick<DocumentSession, 'id' | 'doc' | 'pages' | 'explanations' | 'addGenerated' | 'endGenerated'>

/** Text of a text-content item, or '' for a marked-content item. */
const itemText = (i: unknown): string => (typeof i === 'object' && i !== null && 'str' in i ? (i as TextItem).str : '')

/** The text of file page `source` (0-based), '' when it has none. */
async function pageText(session: SelectionSession, source: number): Promise<{ text: string; items: TextItem[] }> {
  const page = await session.doc.getPage(source + 1)
  const items = (await textContentOf(page)).items.filter((i): i is TextItem => itemText(i) !== '')
  return { text: items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').trim(), items }
}

/** The text of the items whose start lies inside `rect` (PDF user space), in reading order. */
export function textInRect(items: readonly TextItem[], rect: Rect): string {
  const [x1, x2] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])]
  const [y1, y2] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])]
  return items
    .filter((i) => {
      const [x, y] = [i.transform[4], i.transform[5]]
      return x >= x1 && x <= x2 && y >= y1 && y <= y2
    })
    .map((i) => i.str + (i.hasEOL ? '\n' : ' '))
    .join('')
    .trim()
}

/** How the answer is introduced in the explanation field. */
export function selectionLabel(target: SelectionTarget): string {
  if ('rect' in target) return 'On the selected area'
  const t = target.text.replace(/\s+/g, ' ').trim()
  return `On "${t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS).trimEnd()}…` : t}"`
}

/** The page's explanation with the answer appended under its label (a new explanation when there is none). */
export function appended(current: string | undefined, label: string, answer: string): string {
  const entry = `${label}: ${answer.trim()}`
  return current?.trim() ? `${current.trimEnd()}\n\n${entry}` : entry
}

export interface SelectionRunOptions {
  runs?: GenerationRuns
  now?: () => string
  /** Whether the generator gets a picture of an area (it can read pictures and the setting allows them). */
  pictures: boolean
  controller: AbortController
}

/**
 * Explains `target` with `generator` and appends the answer to its page's
 * explanation (one undo step). Progress and failure are in `runs`, shown in
 * the status bar like a page explanation (no Retry: the user just selects
 * again). Nothing is written if the pages changed meanwhile.
 */
export async function explainSelection(
  session: SelectionSession,
  generator: ExplanationGenerator,
  target: SelectionTarget,
  options: SelectionRunOptions,
): Promise<void> {
  const runs = options.runs ?? generationRuns
  const now = options.now ?? (() => new Date().toISOString())
  const { controller } = options
  const id = session.id
  const i = target.page
  const pagesAtStart = session.pages
  const forgotten = () => runs.get(id)?.controller !== controller
  const stop = (message: string) => {
    if (!forgotten()) runs.update(id, { status: 'stopped', message, retry: [], controller: null, pictures: null })
  }
  const entry = pagesAtStart[i]
  if (!entry || entry.kind !== 'source') return stop('Only pages of the file can be explained.')

  let context: PageText[]
  let selected: string
  let picture: PagePicture | null = null
  try {
    // The page and a few around it give the model the lecture's thread.
    const around = pagesAtStart
      .map((p, k) => ({ p, k }))
      .filter(({ p, k }) => Math.abs(k - i) <= CONTEXT_PAGES && p.kind === 'source')
    const read = await Promise.all(around.map(({ p }) => pageText(session, (p as { source: number }).source)))
    context = around.map(({ k }, j) => ({ page: k + 1, text: read[j].text }))
    const own = read[around.findIndex(({ k }) => k === i)]
    selected = 'rect' in target ? textInRect(own.items, target.rect) : target.text
    if ('rect' in target && options.pictures && generator.pictures && !controller.signal.aborted) {
      runs.update(id, { pictures: { done: 0, total: 1 } })
      picture = await renderArea(session.doc, entry, target.rect, i + 1)
      runs.update(id, { pictures: null })
    }
  } catch (e) {
    console.error('Could not prepare the selection', e)
    return stop(`The selection could not be prepared: ${describeError(e)}`)
  }
  if (controller.signal.aborted) return stop('Cancelled.')
  if ('rect' in target && !selected && !picture) {
    return stop("The selected area has no text, and this model can't read pictures.")
  }

  runs.update(id, { status: 'running', done: 0, total: 1 })
  let answer: string | null = null
  try {
    const user = selectionPrompt({
      page: i + 1,
      kind: 'rect' in target ? 'area' : 'text',
      text: selected,
      picture: picture !== null,
      context,
      total: pagesAtStart.length,
      note: generator.pictureNote,
    })
    const outcome = await generator.generate(
      { system: SYSTEM_PROMPT, user, images: picture ? [picture] : [] },
      (line) => {
        const parsed = parseAnswerLine(line)
        if (parsed && parsed.page === i + 1 && answer === null) answer = parsed.text
      },
      controller.signal,
    )
    if (outcome === 'cancelled' || controller.signal.aborted) return stop('Cancelled.')
  } catch (e) {
    console.error('Explaining the selection failed', e)
    return stop(describeError(e))
  }
  if (forgotten()) return
  if (answer === null) return stop('No explanation came back for the selection.')
  // Page numbers must still name the page the selection was on.
  if (!samePages(pagesAtStart, session.pages)) return stop('Stopped: the pages changed while explaining the selection.')
  session.endGenerated()
  session.addGenerated(i, {
    text: appended(session.explanations[i]?.text, selectionLabel(target), answer),
    model: generator.model,
    createdAt: now(),
  })
  session.endGenerated()
  runs.clear(id)
  toasts.show(`Explanation added to page ${i + 1}`)
}
