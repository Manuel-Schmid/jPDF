/**
 * The generator interface: everything that can produce page explanations
 * (Claude Desktop via MCP, a local CLI such as Codex; see #98 and #99)
 * takes a prompt and streams the answer's lines. Prompt, parsing, chunking,
 * retry, progress and the fields are shared and never written per generator
 * (see generate.ts).
 */
import type { PagePicture } from './pictures/render'
import type { PictureNote } from './prompt'

export interface GenerationRequest {
  system: string
  user: string
  /** Pictures of the request's pictured pages, in page order (empty without pictures). */
  images: readonly PagePicture[]
}

/** How a generation ended; an error rejects instead. */
export type GenerationOutcome = 'done' | 'truncated' | 'cancelled'

export interface ExplanationGenerator {
  /** Recorded with each explanation (e.g. the model or tool name). */
  readonly model: string
  /** How the prompt names the attached pictures (each CLI attaches them its own way). */
  readonly pictureNote: PictureNote
  /** Whether it can send pictures; without, pages are still classified so empty pages are skipped. */
  readonly pictures: boolean
  /**
   * Streams the answer to `request`; `onLine` gets each complete line. Resolves
   * when the answer ended (`truncated` when an output limit cut it off) or
   * `signal` aborted it; rejects on an error (lines delivered before stay),
   * with a readable `message`.
   */
  generate(request: GenerationRequest, onLine: (line: string) => void, signal: AbortSignal): Promise<GenerationOutcome>
}
