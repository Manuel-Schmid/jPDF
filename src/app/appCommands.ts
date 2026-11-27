import { commands as defaultCommands, type CommandRegistry } from '../core/registry/commands'
import {
  keybindings as defaultKeybindings,
  type KeybindingRegistry,
} from '../core/registry/keybindings'
import { bindShortcut } from '../core/registry/shortcuts'

/** What the app-level commands do; App supplies them. */
export interface AppCommandActions {
  open(): void
  settings(): void
  /** Settings, opened on the Shortcuts category. */
  shortcuts(): void
  closeTab(): void
  nextTab(): void
  prevTab(): void
  hasTab(): boolean
  toggleThumbnails(): void
}

/**
 * Registers the app's own commands: open, settings, shortcuts, the tab
 * commands and the thumbnail sidebar. `view.thumbnails` is registered here
 * but bound by App after the selection commands, so Ctrl+B makes selected
 * text boxes bold first (see TEXT_STYLE_COMMANDS). Returns the disposer.
 */
export function registerAppCommands(
  a: AppCommandActions,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const tabCommand = (id: string, title: string, run: () => void) => [
    commands.register({ id, title, run, enabled: a.hasTab }),
    bindShortcut(keybindings, id),
  ]
  const disposers = [
    commands.register({ id: 'file.open', title: 'Open PDF…', run: a.open }),
    bindShortcut(keybindings, 'file.open'),
    commands.register({ id: 'app.settings', title: 'Settings', run: a.settings }),
    bindShortcut(keybindings, 'app.settings'),
    commands.register({ id: 'app.shortcuts', title: 'Keyboard shortcuts', run: a.shortcuts }),
    bindShortcut(keybindings, 'app.shortcuts'),
    ...tabCommand('tab.close', 'Close tab', a.closeTab),
    ...tabCommand('tab.next', 'Next tab', a.nextTab),
    ...tabCommand('tab.prev', 'Previous tab', a.prevTab),
    commands.register({ id: 'view.thumbnails', title: 'Page thumbnails', run: a.toggleThumbnails }),
  ]
  return () => disposers.forEach((d) => d())
}
