/**
 * Explanation fields between pages: what each page shows under it and how
 * much height that adds to the page layout. Fields have fixed heights in
 * screen pixels (long text scrolls inside the field), so the layout stays
 * exact without measuring anything and scrolling and zoom keep their place.
 */
import type { PageExplanations } from '../session/explanations'
import type { Explanation } from '../session/model'
import type { PageEntry } from '../session/pages'

/** Gap between a page and its field. */
export const FIELD_GAP = 8
/** Header row (title and buttons); all a collapsed field shows. */
export const FIELD_HEADER = 30
/** The text area of an open field. */
export const FIELD_BODY = 112
/** The "no text on this page" note. */
export const NOTE_HEIGHT = 30
/** Fields are at least this wide (narrow or zoomed-out pages), viewport permitting. */
export const FIELD_MIN_WIDTH = 360

/** What is shown under a page. */
export type FieldState = 'none' | 'note' | 'collapsed' | 'open'

/**
 * The field state of every page: its explanation (collapsed or open), the
 * "no text" note of a page a generation found no text on, or nothing.
 * `hidden` hides every field and note at once.
 */
export function fieldStates(
  pages: readonly PageEntry[],
  explanations: PageExplanations,
  noText: ReadonlySet<PageEntry>,
  collapsed: ReadonlySet<Explanation>,
  hidden: boolean,
): FieldState[] {
  return pages.map((p, i) => {
    if (hidden) return 'none'
    const e = explanations[i]
    if (e) return collapsed.has(e) ? 'collapsed' : 'open'
    return noText.has(p) ? 'note' : 'none'
  })
}

/** Height a field adds below its page (gap included); 0 for none. */
export function fieldExtra(state: FieldState): number {
  switch (state) {
    case 'none':
      return 0
    case 'note':
      return FIELD_GAP + NOTE_HEIGHT
    case 'collapsed':
      return FIELD_GAP + FIELD_HEADER
    case 'open':
      return FIELD_GAP + FIELD_HEADER + FIELD_BODY
  }
}

/** Left edge and width of a page's field: centred under the page, at least FIELD_MIN_WIDTH wide if the content allows. */
export function fieldBox(pageLeft: number, pageWidth: number, contentWidth: number, margin: number): { left: number; width: number } {
  const width = Math.max(pageWidth, Math.min(FIELD_MIN_WIDTH, contentWidth - 2 * margin))
  const left = Math.max(margin, Math.min(pageLeft + (pageWidth - width) / 2, contentWidth - margin - width))
  return { left, width }
}
