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

export const SYSTEM_PROMPT = [
  'You explain the pages of a document, for example university lecture slides, to a student reading along.',
  'For every page you are given, write a short explanation of 2 to 4 sentences: what the page says and what it means,',
  'connected to earlier pages where that helps. Write in the language of the document.',
  'Answer with exactly one JSON object per line and nothing else (no code fences, no comments), in page order:',
  '{"page": <page number>, "text": "<explanation>"}',
  'Use the page numbers exactly as given. Escape quotes and line breaks inside the text as JSON requires.',
].join('\n')

/** Collapses runs of blank space (slide text has many) and cuts very long pages. */
export function cleanPageText(text: string): string {
  const t = text.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return t.length > MAX_PAGE_CHARS ? `${t.slice(0, MAX_PAGE_CHARS)} […]` : t
}

/** The user message: every page's number and text. `total` is the document's page count (context for a chunk). */
export function userPrompt(pages: readonly PageText[], total: number): string {
  const parts = pages.map((p) => `=== Page ${p.page} ===\n${cleanPageText(p.text)}`)
  const numbers = pages.map((p) => p.page)
  const which = pages.length === total ? `all ${total} pages` : `pages ${numbers.join(', ')} of ${total}`
  return `Explain ${which} of this document (one JSON line per page: ${numbers.length} lines).\n\n${parts.join('\n\n')}`
}
