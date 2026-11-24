/**
 * Continuing a generation that stopped (cancelled, cut off, network error):
 * the pages that already arrived are kept, and Retry asks again from the
 * first page that is missing instead of starting over.
 */

/**
 * The pages to request again: the planned pages from the first one that has
 * no answer on, minus those answered since (answers may arrive out of order).
 * Empty when everything arrived.
 */
export function retryPages(planned: readonly number[], arrived: ReadonlySet<number>): number[] {
  const first = planned.findIndex((p) => !arrived.has(p))
  if (first < 0) return []
  return planned.slice(first).filter((p) => !arrived.has(p))
}
