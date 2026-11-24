/**
 * Splitting a document into requests. Free tiers are limited mainly by
 * requests per day, so a document goes out in ONE request whenever it fits:
 * only above ~150 pages, or when the expected answer would come close to the
 * model's output limit (or the text is huge), it is split into a few large
 * chunks of even size, sent one after another. Pages that get a picture are
 * capped separately (pictures are heavy on the plan and on the request size).
 */
import type { PageText } from './prompt'

export interface ChunkLimits {
  /** Most pages in one request. */
  maxPages: number
  /** Output tokens the answer may use (below the model's output limit). */
  maxOutputTokens: number
  /**
   * Expected answer tokens per page, on average: the prompt asks for one
   * sentence on trivial pages up to about six on content pages (model answers
   * included), plus the JSON around it. 140 is a fair average; with the
   * default limits the 150-page cap binds first (32 000 / 140 ≈ 228).
   */
  tokensPerPage: number
  /** Most characters of page text in one request (~4 characters per token). */
  maxInputChars: number
  /** Most pages with a picture in one request. */
  maxPictures: number
}

export const DEFAULT_LIMITS: ChunkLimits = {
  maxPages: 150,
  maxOutputTokens: 32000,
  tokensPerPage: 140,
  maxInputChars: 400_000,
  maxPictures: 40,
}

/**
 * Roughly what one page picture costs of the input, in characters of text:
 * a 1280 px picture is about 1 500 tokens, at ~4 characters per token.
 */
export const PICTURE_CHARS = 6000

/** A page to explain, with its text and whether a picture goes with it. */
export interface PlannedPage {
  page: number
  text: string
  picture: boolean
}

const pictureCount = (pages: readonly PlannedPage[]) => pages.reduce((n, p) => n + (p.picture ? 1 : 0), 0)

const charCount = (pages: readonly PlannedPage[]) => pages.reduce((n, p) => n + p.text.length, 0)

/** Pages per request allowed by the page limit and the expected answer size. */
const perRequestOf = (limits: ChunkLimits) =>
  Math.max(1, Math.min(limits.maxPages, Math.floor(limits.maxOutputTokens / limits.tokensPerPage)))

function sliceEvenly<T>(pages: readonly T[], n: number): T[][] {
  // Balanced sizes, larger parts first: 151 pages become 76 + 75 (not 150 + 1)
  // and 10 pages in 4 parts become 3/3/2/2 (not 3/3/3/1).
  const base = Math.floor(pages.length / n)
  const extra = pages.length % n
  const out: T[][] = []
  let at = 0
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0)
    out.push(pages.slice(at, at + size))
    at += size
  }
  return out
}

/** Cuts in order, starting a new chunk whenever the next page would break a cap. */
function cutGreedily(pages: readonly PlannedPage[], limits: ChunkLimits, perRequest: number): PlannedPage[][] {
  const out: PlannedPage[][] = []
  let cur: PlannedPage[] = []
  let pictures = 0
  let chars = 0
  for (const p of pages) {
    const full =
      cur.length >= perRequest ||
      (p.picture && pictures >= limits.maxPictures) ||
      (cur.length > 0 && chars + p.text.length > limits.maxInputChars)
    if (full) {
      out.push(cur)
      cur = []
      pictures = 0
      chars = 0
    }
    cur.push(p)
    if (p.picture) pictures++
    chars += p.text.length
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * The pages split into requests (in order, every page once). Fewest requests
 * first, then even sizes: the smallest n whose even parts respect the page,
 * picture and text limits. When pictures are bunched, even parts would need
 * more requests than cutting at the caps, so the greedy cut wins.
 */
export function chunkPlanned(pages: readonly PlannedPage[], limits: ChunkLimits = DEFAULT_LIMITS): PlannedPage[][] {
  if (pages.length === 0) return []
  const perRequest = perRequestOf(limits)
  const chars = pages.reduce((n, p) => n + p.text.length, 0)
  const start = Math.min(pages.length, Math.max(Math.ceil(pages.length / perRequest), Math.ceil(chars / limits.maxInputChars)))
  const greedy = cutGreedily(pages, limits, perRequest)
  for (let n = start; n <= greedy.length; n++) {
    const even = sliceEvenly(pages, n)
    // Pictures and text are checked per part: the start bound only covers the totals.
    if (even.every((c) => pictureCount(c) <= limits.maxPictures && charCount(c) <= limits.maxInputChars)) return even
  }
  return greedy
}

/**
 * The document text sent along with a chunk for orientation: `null` when the
 * chunk is the whole document (the prompt then needs no separate context),
 * every page when the text is small enough, otherwise the pages within
 * `window` of the chunk so a huge document still fits one request. The
 * chunk's pictures count against `maxInputChars` too (PICTURE_CHARS each).
 */
export function contextFor(
  all: readonly PageText[],
  chunk: readonly PlannedPage[],
  maxInputChars: number,
  window = 40,
): readonly PageText[] | null {
  const inChunk = new Set(chunk.map((p) => p.page))
  if (all.every((p) => inChunk.has(p.page))) return null
  const pictures = pictureCount(chunk) * PICTURE_CHARS
  if (all.reduce((n, p) => n + p.text.length, 0) + pictures <= maxInputChars) return all
  // A retry chunk may be scattered; the window spans its first to last page.
  const first = Math.min(...inChunk) - window
  const last = Math.max(...inChunk) + window
  return all.filter((p) => p.page >= first && p.page <= last)
}
