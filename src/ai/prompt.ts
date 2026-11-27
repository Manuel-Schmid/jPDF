/**
 * The prompt for page explanations, shared by every generator (Claude
 * Desktop, a local CLI; see generator.ts): the whole document (or one large
 * chunk) in one request, answered with one JSON line per page so the fields
 * fill in while the answer streams.
 */

/** A page to explain: its number as the user sees it (1-based) and its text. */
export interface PageText {
  page: number
  text: string
}

/** Longest text sent per page; longer pages are cut (explanations stay short anyway). */
export const MAX_PAGE_CHARS = 6000

/** Shared by both CLIs; src-tauri/src/ai/real_cli.rs keeps a copy (drift-guard test). */
export const SYSTEM_PROMPT = `You write study explanations for the pages of a document, usually university lecture slides, for a student preparing for the exam. You get the text of the whole document for context, and pictures of some pages.

For each page you are asked to explain:
- Start directly with the substance: the concept, claim or result. Never begin with "This slide", "This page", "The slide shows" or similar, and do not describe the slide itself.
- Explain the concepts clearly, correctly and precisely: what they mean, why they matter, and how they connect to concepts from earlier pages (name the concept, not the page number).
- For questions, quizzes, exercises and exam tasks, give a concise model answer with the key reasoning.
- For diagrams, figures, tables and code, say concretely what they show (the elements, how they relate, what the code computes) and what to take away from them.
- If a page repeats the previous page with an addition (an animation step), explain only what is new.
- For title, agenda, break, literature and "Questions?" pages, write one short sentence.
- Add a short concrete example only when it really makes a concept easier to understand and the page does not already give one. Most pages need no example.
- Do not guess. If part of a page cannot be read, say so in a few words instead of speculating.
- Where it matters, distinguish the lecturer's own view or a course convention from generally accepted facts.
- Let the length follow the content: one sentence for trivial pages, usually two to five for content pages, at most about six.
- Plain text only: no Markdown, no bullet characters, no headings.
- Write in the language of the document.

Answer with exactly one JSON object per line and nothing else (no code fences, no comments), in page order:
{"page": <page number>, "text": "<explanation>"}
Use the page numbers exactly as given. Escape quotes and line breaks inside the text as JSON requires.`

/** Collapses runs of blank space (slide text has many) and cuts very long pages. */
export function cleanPageText(text: string): string {
  const t = text.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return t.length > MAX_PAGE_CHARS ? `${t.slice(0, MAX_PAGE_CHARS)} […]` : t
}

/** Which CLI gets the pictures: Claude labels each one inline, Codex gets them in page order. */
export type PictureNote = 'claude' | 'codex'

/** A page's explanation being redone on its own (the explanation field's Regenerate menu). */
export interface Revision {
  /** What should change (e.g. "Simpler"), or null to just generate it again. */
  instruction: string | null
  /** The page's explanation now, or null when it has none. */
  current: string | null
}

export interface PromptInput {
  /** Pages to explain in this request; text may be '' for a pictured page without text. */
  explain: readonly PageText[]
  /** Page texts sent for context when the request does not cover the whole document; null when `explain` is all of it. */
  context: readonly PageText[] | null
  /** The document's page count. */
  total: number
  /** Page numbers with a picture in this request, ascending. */
  pictures: readonly number[]
  note: PictureNote
  /** Redoing one page's explanation: its current text and what to change (absent: a normal run). */
  revision?: Revision | null
}

/**
 * Ascending page numbers as runs: `4–6` for consecutive pages, `1–4, 6–56`
 * when a few are missing (a Retry, or the context around a scattered chunk),
 * single pages as plain numbers (`5, 17–18, 40`).
 */
export function pageRanges(pages: readonly number[]): string {
  const runs: string[] = []
  for (let i = 0; i < pages.length; ) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++
    runs.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`)
    i = j + 1
  }
  return runs.join(', ')
}

/** One `=== Page n ===` block per page; pages without text appear only when they have a picture. */
function pageBlocks(pages: readonly PageText[], pictured: ReadonlySet<number>): string {
  const blocks: string[] = []
  for (const p of pages) {
    const text = cleanPageText(p.text)
    if (text) blocks.push(`=== Page ${p.page} ===\n${text}`)
    else if (pictured.has(p.page)) blocks.push(`=== Page ${p.page} ===\n(no text; see its picture)`)
  }
  return blocks.join('\n\n')
}

/**
 * The user message: what to explain, which pages come with a picture, and the
 * page texts (the whole document, or the whole document as context plus the
 * request's own range).
 */
export function userPrompt(input: PromptInput): string {
  const prompt = basePrompt(input)
  const note = input.revision ? revisionNote(input.revision) : ''
  return note ? `${prompt}\n\n${note}` : prompt
}

/**
 * What a revision adds after the page texts: the current explanation, so
 * "shorter" or "more detail" have something to refer to, and the request,
 * which may override the length and language rules but not the format.
 */
export function revisionNote(r: Revision): string {
  const parts: string[] = []
  if (r.current?.trim()) parts.push(`The page's current explanation:\n${r.current.trim()}`)
  if (r.instruction?.trim()) {
    parts.push(
      `Write a new explanation that follows this request: ${r.instruction.trim()}\n` +
        'The request takes precedence over the length, example and language rules, but keep the answer format (one JSON line).',
    )
  } else if (parts.length > 0) {
    parts.push('Write a new explanation instead of repeating the current one.')
  }
  return parts.join('\n\n')
}

function basePrompt(input: PromptInput): string {
  const { explain, context, total, pictures, note } = input
  const pictured = new Set(pictures)
  const numbers = explain.map((p) => p.page)
  const which = !context ? `all ${total} pages` : numbers.length === 1 ? `page ${numbers[0]}` : `pages ${pageRanges(numbers)}`
  let ask = `Explain ${which} of this document (one JSON line per page: ${numbers.length} lines).`
  if (pictures.length === 1) {
    const [only] = pictures
    ask += note === 'claude' ? ` Picture of page ${only} is attached.` : ` The attached picture shows page ${only}.`
  } else if (pictures.length > 1) {
    const list = pictures.join(', ')
    ask += note === 'claude' ? ` Pictures of pages ${list} are attached.` : ` The attached pictures show pages ${list}, in this order.`
  }
  if (!context) return `${ask}\n\n${pageBlocks(explain, pictured)}`
  const covered = context.length === total ? `all ${total} pages` : `pages ${pageRanges(context.map((p) => p.page))} of ${total}`
  return `Document text (${covered}, for context):\n\n${pageBlocks(context, pictured)}\n\n${ask}`
}

/** Longest selected text sent (a selection is a sentence or a formula; more is cut). */
export const MAX_SELECTION_CHARS = 2000

/** What the user selected to have explained ("Explain this"): an area of a page, or text on it. */
export interface SelectionInput {
  /** The page (1-based) the selection is on. */
  page: number
  /** 'area': a lassoed part of the page (a picture of it may be attached); 'text': selected text. */
  kind: 'area' | 'text'
  /** The selected text, or the text found inside the area ('' when it has none, e.g. a diagram). */
  text: string
  /** Whether a picture of the area is attached. */
  picture: boolean
  /** The text of the page and its neighbours, for context. */
  context: readonly PageText[]
  /** The document's page count. */
  total: number
  note: PictureNote
}

/**
 * The user message for "Explain this": the nearby pages for context, then
 * what was selected, answered like a page explanation (one JSON line for
 * the selection's page) but about the selection only.
 */
export function selectionPrompt(input: SelectionInput): string {
  const { page, kind, picture, context, total, note } = input
  const text = cleanPageText(input.text).slice(0, MAX_SELECTION_CHARS)
  const covered = `pages ${pageRanges(context.map((p) => p.page))} of ${total}`
  const parts = [`Document text (${covered}, for context):\n\n${pageBlocks(context, new Set())}`]
  let ask: string
  if (kind === 'text') {
    ask = `Explain only this text the student selected on page ${page}, not the whole page:\n${text}`
  } else {
    const shown = picture
      ? note === 'claude'
        ? ` A picture of the selected area of page ${page} is attached.`
        : ` The attached picture shows the selected area of page ${page}.`
      : ''
    ask = `Explain only the part of page ${page} the student selected, not the whole page.${shown}`
    ask += text ? `\nThe selected area contains this text:\n${text}` : picture ? '' : '\n(The selected area has no text.)'
  }
  parts.push(
    `${ask}\n\nAnswer with exactly one JSON line, using page number ${page}: {"page": ${page}, "text": "<explanation>"}. ` +
      'Start directly with the explanation; do not mention that it is a selection.',
  )
  return parts.join('\n\n')
}
