import { commands as defaultCommands, type CommandRegistry } from '../registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../registry/keybindings'
import { bindShortcut } from '../registry/shortcuts'
import type { DocumentSession } from '../session/session.svelte'

export const ZOOM_STEP = 1.25

/**
 * Registers view.zoomIn / view.zoomOut / view.fitWidth and
 * view.nextPage / view.previousPage (Right / Left: flip and fit the page, see
 * DocumentSession.flipPage) for the active session. The page flips are off
 * while annotations are selected or a text box is edited: the arrows then
 * nudge the selection or move the caret.
 */
export function registerViewCommands(
  active: () => DocumentSession | null,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const defs = [
    {
      id: 'view.zoomIn',
      title: 'Zoom in',
      run: (s: DocumentSession) => s.zoomTo(s.scale * ZOOM_STEP),
    },
    {
      id: 'view.zoomOut',
      title: 'Zoom out',
      run: (s: DocumentSession) => s.zoomTo(s.scale / ZOOM_STEP),
    },
    {
      id: 'view.fitWidth',
      title: 'Fit width',
      run: (s: DocumentSession) => s.fitWidth(),
    },
    {
      id: 'view.nextPage',
      title: 'Next page',
      run: (s: DocumentSession) => s.flipPage(1),
      flip: true,
    },
    {
      id: 'view.previousPage',
      title: 'Previous page',
      run: (s: DocumentSession) => s.flipPage(-1),
      flip: true,
    },
  ]
  const free = (s: DocumentSession) => s.toolState.selection.length === 0 && s.toolState.textEdit === null
  const disposers = defs.flatMap((d) => [
    commands.register({
      id: d.id,
      title: d.title,
      run: () => {
        const s = active()
        if (s) d.run(s)
      },
      enabled: () => {
        const s = active()
        return s !== null && (!('flip' in d) || free(s))
      },
    }),
    bindShortcut(keybindings, d.id),
  ])
  return () => disposers.forEach((d) => d())
}
