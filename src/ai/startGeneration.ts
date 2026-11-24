/**
 * Starting a generation from the UI: asks before overwriting existing
 * explanations, then loads the generation code (only now: nothing of it
 * loads while AI features are unused) and runs it with the local CLI.
 * This file must keep no static import of generate.ts, cliGenerator.ts or
 * cliIpc.ts, since the (eagerly loaded) status bar reaches it.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import { hasAnyExplanation } from '../core/session/explanations'
import { generationAction } from './action'
import type { CliConfig } from './cliIpc'
import { generationRuns } from './runs.svelte'

export interface StartDeps {
  confirm(message: string, confirmLabel: string): Promise<boolean>
}

/** "Add/Regenerate explanations": the whole document, after confirming an overwrite. */
export async function startGeneration(session: DocumentSession, config: CliConfig, deps: StartDeps): Promise<void> {
  if (generationRuns.isActive(session.id)) return
  const action = generationAction(hasAnyExplanation(session.explanations))
  if (action.confirm && !(await deps.confirm(action.confirm, 'Regenerate'))) return
  await run(session, config)
}

/** Retry: the pages a stopped run is missing, continuing from the first one. */
export async function retryGeneration(session: DocumentSession, config: CliConfig): Promise<void> {
  const pages = generationRuns.get(session.id)?.retry ?? []
  if (pages.length === 0 || generationRuns.isActive(session.id)) return
  await run(session, config, pages)
}

async function run(session: DocumentSession, config: CliConfig, pages?: number[]): Promise<void> {
  const [{ generateExplanations }, { cliGenerator, limitsFor }] = await Promise.all([
    import('./generate'),
    import('./cliGenerator'),
  ])
  await generateExplanations(session, cliGenerator(config), { pages, limits: limitsFor(config.cli) })
}
