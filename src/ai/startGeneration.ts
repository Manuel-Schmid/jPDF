/**
 * Starting a generation from the UI: asks before overwriting existing
 * explanations, then loads the generation code (only now: nothing of it
 * loads while AI features are unused) and runs it with the local CLI.
 * This file must keep no static import of generate.ts, cliGenerator.ts,
 * cliCache.ts or cliIpc.ts, since the (eagerly loaded) status bar reaches it.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import { hasAnyExplanation } from '../core/session/explanations'
import type { Preferences } from '../core/settings/preferences'
import { generationAction } from './action'
import type { CliConfig } from './cliIpc'
import { generationRuns } from './runs.svelte'

/** The Page pictures setting. */
type PictureMode = Preferences['aiPictures']

export interface StartDeps {
  confirm(message: string, confirmLabel: string): Promise<boolean>
}

/** "Add/Regenerate explanations": the whole document, after confirming an overwrite. */
export async function startGeneration(session: DocumentSession, config: CliConfig, deps: StartDeps, pictures: PictureMode = 'useful'): Promise<void> {
  if (generationRuns.isActive(session.id)) return
  const action = generationAction(hasAnyExplanation(session.explanations))
  if (action.confirm && !(await deps.confirm(action.confirm, 'Regenerate'))) return
  await run(session, config, pictures)
}

/** Retry: the pages a stopped run is missing, continuing from the first one. */
export async function retryGeneration(session: DocumentSession, config: CliConfig, pictures: PictureMode = 'useful'): Promise<void> {
  const pages = generationRuns.get(session.id)?.retry ?? []
  if (pages.length === 0 || generationRuns.isActive(session.id)) return
  await run(session, config, pictures, pages)
}

async function run(session: DocumentSession, config: CliConfig, pictures: PictureMode, pages?: number[]): Promise<void> {
  const [{ generateExplanations }, { cliGenerator, limitsFor }, { knownPictureSupport, lookupModels }] = await Promise.all([
    import('./generate'),
    import('./cliGenerator'),
    import('./cliCache'),
  ])
  // The cached model list says whether the model reads pictures. Without it
  // (Settings not opened this session) Codex lists its models once, since a
  // text-only model would make the CLI refuse the pictures; Claude's models
  // all read them. If the list cannot be had, pictures are tried.
  let canRead = knownPictureSupport(config.cli, config.path, config.model)
  if (canRead === undefined && config.cli === 'codex') {
    await lookupModels(config.cli, config.path).catch(() => {})
    canRead = knownPictureSupport(config.cli, config.path, config.model)
  }
  canRead ??= true
  await generateExplanations(session, cliGenerator(config, undefined, { pictures: canRead }), {
    pages,
    limits: limitsFor(config.cli),
    pictures,
  })
}
