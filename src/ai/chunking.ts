/**
 * Splitting a document into requests. Free tiers are limited mainly by
 * requests per day, so a document goes out in ONE request whenever it fits:
 * only above ~150 pages, or when the expected answer would come close to the
 * model's output limit (or the text is huge), it is split into a few large
 * chunks of even size, sent one after another.
 */
import type { PageText } from './prompt'

export interface ChunkLimits {
  /** Most pages in one request. */
  maxPages: number
  /** Output tokens the answer may use (below the model's output limit). */
  maxOutputTokens: number
  /** Expected answer tokens per page (2–4 sentences plus the JSON around them). */
  tokensPerPage: number
  /** Most characters of page text in one request (~4 characters per token). */
  maxInputChars: number
}

export const DEFAULT_LIMITS: ChunkLimits = {
  maxPages: 150,
  maxOutputTokens: 32000,
  tokensPerPage: 140,
  maxInputChars: 400_000,
}

/** The pages split into requests (in order, every page once); one chunk when everything fits. */
export function chunkPages(pages: readonly PageText[], limits: ChunkLimits = DEFAULT_LIMITS): PageText[][] {
  if (pages.length === 0) return []
  const perRequest = Math.max(1, Math.min(limits.maxPages, Math.floor(limits.maxOutputTokens / limits.tokensPerPage)))
  const chars = pages.reduce((n, p) => n + p.text.length, 0)
  const count = Math.max(Math.ceil(pages.length / perRequest), Math.ceil(chars / limits.maxInputChars))
  const n = Math.min(pages.length, count)
  // Even sizes: 151 pages become 76 + 75, not 150 + 1.
  const size = Math.ceil(pages.length / n)
  const out: PageText[][] = []
  for (let i = 0; i < pages.length; i += size) out.push(pages.slice(i, i + size))
  return out
}
