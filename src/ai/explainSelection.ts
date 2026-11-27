/**
 * Starting "Explain this" from the UI (the lasso's area bar, the selection
 * bar, the page menu's "Explain selected text"). Like startGeneration.ts it
 * keeps no static import of the generation code: the viewer loads it eagerly.
 */
import type { DocumentSession } from '../core/session/session.svelte'
import type { Preferences } from '../core/settings/preferences'
import { toasts } from '../ui/toasts.svelte'
import { cliConfigOf } from './config'
import { generationRuns } from './runs.svelte'
import type { SelectionTarget } from './selectionRun'

export type { SelectionTarget }

/**
 * Explains `target` with the CLI from the preferences; the answer is
 * appended to its page's explanation. Does nothing while a generation of
 * the document is running. A failure to start is reported, never thrown.
 */
export function startSelectionExplanation(session: DocumentSession, prefs: Preferences, target: SelectionTarget): void {
  if (generationRuns.isActive(session.id)) return
  const config = cliConfigOf(prefs)
  const controller = new AbortController()
  // Shown at once (with Cancel), under the selection's page: its field spins.
  generationRuns.update(session.id, {
    status: 'preparing',
    done: 0,
    total: 1,
    message: null,
    retry: [],
    controller,
    pictures: null,
    revision: { page: target.page, revision: { instruction: null, current: null } },
  })
  void (async () => {
    try {
      const [{ explainSelection }, { cliGenerator }, { knownPictureSupport }] = await Promise.all([
        import('./selectionRun'),
        import('./cliGenerator'),
        import('./cliCache'),
      ])
      // Unknown picture support counts as yes, as for page explanations.
      const canRead = knownPictureSupport(config.cli, config.path, config.model) ?? true
      // An area always gets its picture (the Page pictures setting is about
      // whole pages): a lassoed formula or diagram is exactly where it helps.
      await explainSelection(session, cliGenerator(config, undefined, { pictures: canRead }), target, {
        pictures: true,
        controller,
      })
    } catch (e) {
      console.error('Could not explain the selection', e)
      if (generationRuns.get(session.id)?.controller === controller) {
        generationRuns.update(session.id, { status: 'stopped', message: 'Could not explain the selection.', retry: [], controller: null })
      }
      toasts.show('Could not explain the selection', 'error')
    }
  })()
}
