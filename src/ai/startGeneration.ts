/**
 * Starting a generation from the UI: asks before overwriting existing
 * explanations, then loads the generation code (only now: nothing of it
 * loads while AI features are unused) and runs it with the API-key generator.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import { hasAnyExplanation } from '../core/session/explanations'
import { generationAction } from './action'
import type { AiConfig } from './ipc'
import { generationRuns } from './runs.svelte'

export interface StartDeps {
  confirm(message: string, confirmLabel: string): Promise<boolean>
}

/** "Add/Regenerate explanations": the whole document (after confirming an overwrite). */
export async function startGeneration(session: DocumentSession, ai: AiConfig, deps: StartDeps): Promise<void> {
  if (generationRuns.isActive(session.id)) return
  const action = generationAction(hasAnyExplanation(session.explanations))
  if (action.confirm && !(await deps.confirm(action.confirm, 'Regenerate'))) return
  await run(session, ai)
}

/** Retry: the pages a stopped run is missing, continuing from the first one. */
export async function retryGeneration(session: DocumentSession, ai: AiConfig): Promise<void> {
  const pages = generationRuns.get(session.id)?.retry ?? []
  if (pages.length === 0 || generationRuns.isActive(session.id)) return
  await run(session, ai, pages)
}

async function run(session: DocumentSession, ai: AiConfig, pages?: number[]): Promise<void> {
  const [{ generateExplanations }, { apiKeyGenerator }] = await Promise.all([import('./generate'), import('./generator')])
  const generator = apiKeyGenerator(ai)
  await generateExplanations(session, generator, { pages })
}
