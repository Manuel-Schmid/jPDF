/** Longest selected text taken (the prompt cuts it further). */
const MAX_CHARS = 4000

/**
 * The text selected on a page's text layer (pdf.js `.textLayer`), trimmed;
 * '' when nothing is selected there, e.g. a selection inside an
 * explanation field or another text box of the app.
 */
export function selectedPageText(selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection()): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const node = selection.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  if (!el?.closest('.textLayer')) return ''
  return selection.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
}
