/**
 * Regenerating a single page's explanation from the UI (the explanation
 * field's Regenerate menu, the page menu's "Generate explanation"). Like
 * startGeneration.ts it keeps no static import of the generation code, since
 * the viewer loads it eagerly.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import type { Preferences } from '../core/settings/preferences'
import type { FieldAi } from '../core/viewer/ExplanationField.svelte'
import { toasts } from '../ui/toasts.svelte'
import { cliConfigOf } from './config'
import { generationRuns } from './runs.svelte'
import { regeneratePage } from './startGeneration'

/** Starts regenerating page `index` (0-based); a failure to start is reported, never thrown. */
export function startPageRegeneration(session: DocumentSession, prefs: Preferences, index: number, instruction: string | null = null): void {
  regeneratePage(session, cliConfigOf(prefs), index, instruction, prefs.aiPictures).catch((e) => {
    console.error('Could not start regenerating the explanation', e)
    toasts.show('Could not start regenerating the explanation', 'error')
  })
}

/**
 * What page `index`'s explanation field needs for AI, or null while AI
 * features are off. Reads the run state reactively (call it in markup).
 */
export function fieldAi(session: DocumentSession, prefs: Preferences, index: number): FieldAi | null {
  if (!prefs.aiEnabled) return null
  const active = generationRuns.isActive(session.id)
  const page = generationRuns.get(session.id)?.revision?.page
  return {
    running: !active ? null : page === index ? 'this' : 'other',
    regenerate: (instruction) => startPageRegeneration(session, prefs, index, instruction),
    cancel: () => generationRuns.cancel(session.id),
  }
}
