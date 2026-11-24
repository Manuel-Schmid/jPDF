/** User-facing messages for errors of the AI features (key, quota, network, provider). */
import { isAppError } from '../core/ipc/api'

/** A user-facing message for a generation error. */
export function describeAiError(e: unknown): string {
  if (isAppError(e)) {
    if (e.code === 'AiKey') return `The API key is missing or was rejected (${e.message}). Check it in Settings → AI features.`
    if (e.code === 'AiRateLimit') return `The provider's rate limit or free quota was reached (${e.message}). Try again later.`
    if (e.code === 'AiNetwork') return `The provider could not be reached: ${e.message}`
    if (e.code === 'AiUnavailable') {
      return `The provider is busy right now (${e.message}). Try again in a minute, or choose another model in Settings → AI.`
    }
    if (e.code === 'AiService') return `The provider reported an error: ${e.message}`
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}
