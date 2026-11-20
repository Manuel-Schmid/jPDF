import { getCurrentWindow } from '@tauri-apps/api/window'
import { commands as defaultCommands, type CommandRegistry } from '../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../core/registry/keybindings'
import type { ViewAnchor } from '../core/session/session.svelte'
import { toasts } from '../ui/toasts.svelte'
import { restoreAfterResize, SETTLE_MS } from './keepView'

interface FullscreenWindow {
  setFullscreen(on: boolean): Promise<void>
  isFullscreen(): Promise<boolean>
}

/**
 * Window fullscreen. The shell hides its chrome while `active`; `anchor` (set by
 * the app) captures the current page position before the switch and returns the
 * function that restores it once the resize has settled.
 */
export class Fullscreen {
  active = $state(false)
  anchor: (() => ViewAnchor | null) | null = null
  /** Toggles in flight: resize events during one must not re-read the state. */
  private pending = 0

  constructor(
    private getWindow: () => FullscreenWindow = getCurrentWindow,
    private settleMs = SETTLE_MS,
  ) {}

  async toggle(): Promise<void> {
    await this.set(!this.active)
  }

  async exit(): Promise<void> {
    if (this.active) await this.set(false)
  }

  /** Follows the window when fullscreen was left by other means (e.g. the OS). */
  async sync(): Promise<void> {
    if (this.pending > 0) return
    try {
      this.active = await this.getWindow().isFullscreen()
    } catch (e) {
      console.error('Could not read the fullscreen state', e)
    }
  }

  /** Re-reads the state on every window resize until the returned function is called. */
  start(): () => void {
    const onResize = () => void this.sync()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }

  private async set(on: boolean): Promise<void> {
    const anchor = this.anchor?.() ?? null
    this.pending++
    try {
      try {
        await this.getWindow().setFullscreen(on)
      } catch (e) {
        console.error('Could not change fullscreen', e)
        toasts.show('Could not change fullscreen mode', 'error')
        return
      }
      this.active = on
      if (anchor) await restoreAfterResize(anchor, this.settleMs)
    } finally {
      this.pending--
    }
  }
}

export const fullscreen = new Fullscreen()

/**
 * view.fullscreen (F11) and view.exitFullscreen (Escape, only while fullscreen).
 * Escape priority: the text editor and popups consume the key first (they stop
 * its propagation); then the first enabled Escape command wins, so register
 * these AFTER edit.deselect: a selection is cleared before fullscreen is left.
 */
export function registerFullscreenCommands(
  fs: Fullscreen = fullscreen,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = [
    commands.register({ id: 'view.fullscreen', title: 'Toggle fullscreen', run: () => fs.toggle() }),
    keybindings.bind('F11', 'view.fullscreen'),
    commands.register({
      id: 'view.exitFullscreen',
      title: 'Exit fullscreen',
      enabled: () => fs.active,
      run: () => fs.exit(),
    }),
    keybindings.bind('Escape', 'view.exitFullscreen'),
  ]
  return () => disposers.forEach((d) => d())
}
