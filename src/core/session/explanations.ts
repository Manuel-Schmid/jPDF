/**
 * Page explanations as the session holds them: one slot per page of the
 * page list (`null`: none), replaced as a whole on every change so a change
 * is cheap to detect. Page commands keep the slots in step with the pages
 * (see pageCommands); edits are undoable commands here.
 */
import type { Command } from './history.svelte'
import type { Explanation } from './model'

export type PageExplanations = readonly (Explanation | null)[]

/** Owner of the explanation slots (the DocumentSession). */
export interface ExplanationHost {
  explanations: PageExplanations
  /**
   * Sets the slots for an explanation edit (optional): the session uses it to
   * keep the page being read in place when a field appears or disappears
   * above it. Page operations set `explanations` directly.
   */
  replaceExplanations?(next: PageExplanations): void
}

function setSlots(host: ExplanationHost, next: PageExplanations): void {
  if (host.replaceExplanations) host.replaceExplanations(next)
  else host.explanations = next
}

/** `numPages` slots from what the file had (missing slots are empty). */
export function explanationSlots(read: readonly (Explanation | null | undefined)[], numPages: number): PageExplanations {
  return Array.from({ length: numPages }, (_, i) => read[i] ?? null)
}

export function hasAnyExplanation(list: PageExplanations): boolean {
  return list.some((e) => e !== null)
}

/** An undo step setting explanations, which a streamed generation keeps extending. */
export interface ExplanationsCommand extends Command {
  /** Sets one more slot as part of this (already executed) step. */
  extend(page: number, explanation: Explanation | null): void
}

/**
 * Sets the slots in `changes` (page index → explanation or null) as one
 * undo step; undo puts back the exact previous list.
 */
export function setExplanations(
  host: ExplanationHost,
  changes: ReadonlyMap<number, Explanation | null>,
  label = 'Edit explanation',
): ExplanationsCommand {
  const all = new Map(changes)
  let before: PageExplanations = []
  const apply = (list: PageExplanations, entries: Iterable<[number, Explanation | null]>) => {
    const next = list.slice()
    for (const [i, e] of entries) if (i >= 0 && i < next.length) next[i] = e
    return next
  }
  return {
    label,
    do: () => {
      before = host.explanations
      setSlots(host, apply(before, all))
    },
    undo: () => {
      setSlots(host, before)
    },
    extend: (page, explanation) => {
      all.set(page, explanation)
      setSlots(host, apply(host.explanations, [[page, explanation]]))
    },
  }
}
