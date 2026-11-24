/**
 * The generator interface: everything that can produce explanations
 * (an API key now; a local CLI or Claude Desktop later) takes a prompt and
 * streams answer lines. Prompt, parsing, chunking, retry, progress and UI
 * are shared and never written per generator.
 */
import { aiCancel, aiGenerate, type AiConfig, type StreamOutcome } from './ipc'

export interface GenerationRequest {
  system: string
  user: string
}

export interface ExplanationGenerator {
  /** Recorded with each explanation (e.g. the model name). */
  readonly model: string
  /**
   * Streams the answer to `request`; `onLine` gets each complete line. Resolves
   * when the answer ended (`truncated` when the output limit cut it off) or
   * `signal` aborted it; rejects on an error (lines delivered before stay).
   */
  generate(request: GenerationRequest, onLine: (line: string) => void, signal: AbortSignal): Promise<StreamOutcome>
}

let nextRequestId = 1

/** The API-key generator: an OpenAI-compatible endpoint, key from the Credential Manager. */
export function apiKeyGenerator(config: AiConfig): ExplanationGenerator {
  return {
    model: config.model,
    async generate(request, onLine, signal) {
      if (signal.aborted) return 'cancelled'
      const id = nextRequestId++
      const cancel = () => void aiCancel(id).catch((e: unknown) => console.error('Could not cancel the request', e))
      signal.addEventListener('abort', cancel, { once: true })
      try {
        return await aiGenerate(id, config, request.system, request.user, (line) => {
          if (!signal.aborted) onLine(line)
        })
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
  }
}
