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

/** Resolves when `p` settles or `signal` aborts, whichever comes first (never rejects). */
function settledOrAborted(p: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
    p.then(() => resolve(), () => resolve())
  })
}

async function run(session: DocumentSession, config: CliConfig, pictures: PictureMode, pages?: number[]): Promise<void> {
  const id = session.id
  // The run shows (with Cancel) from the click on: loading the generation
  // code, and a Codex model lookup, can take a moment before the pages are read.
  const controller = new AbortController()
  generationRuns.update(id, { status: 'preparing', done: 0, total: session.pages.length, message: null, retry: [], controller })
  // Forgotten (its tab closed) or replaced meanwhile: nothing more is reported.
  const ours = () => generationRuns.get(id)?.controller === controller
  try {
    const [{ generateExplanations }, { cliGenerator, limitsFor }, { knownPictureSupport, lookupModels, modelLookupFailed }] =
      await Promise.all([import('./generate'), import('./cliGenerator'), import('./cliCache')])
    // The cached model list says whether the model reads pictures. Without it
    // (Settings not opened this session) Codex lists its models once, since a
    // text-only model would make the CLI refuse the pictures; Claude's models
    // all read them. If the list cannot be had (now or earlier this session),
    // pictures are tried.
    let canRead = knownPictureSupport(config.cli, config.path, config.model)
    if (canRead === undefined && config.cli === 'codex' && !modelLookupFailed(config.cli, config.path)) {
      await settledOrAborted(lookupModels(config.cli, config.path), controller.signal)
      canRead = knownPictureSupport(config.cli, config.path, config.model)
    }
    canRead ??= true
    if (!ours()) return
    if (controller.signal.aborted) {
      generationRuns.update(id, { status: 'stopped', message: 'Cancelled.', retry: pages ?? [], controller: null })
      return
    }
    await generateExplanations(session, cliGenerator(config, undefined, { pictures: canRead }), {
      pages,
      limits: limitsFor(config.cli),
      pictures,
      controller,
    })
  } catch (e) {
    // Before generateExplanations took over (it reports its own failures):
    // the run must not stay 'preparing'.
    if (ours() && generationRuns.isActive(id)) {
      generationRuns.update(id, { status: 'stopped', message: 'Could not start generating explanations.', retry: pages ?? [], controller: null })
    }
    throw e
  }
}
