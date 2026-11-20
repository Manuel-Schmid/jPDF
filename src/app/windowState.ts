import { getWindowState } from '../core/ipc/api'
import type { SettingsStore, WindowState } from '../core/settings/settings.svelte'

/**
 * On close: records how the window is left in the settings (the caller then
 * flushes them), so the backend reopens it that way. A failure only costs the
 * restore next time; it never blocks closing.
 */
export async function rememberWindowState(
  store: Pick<SettingsStore, 'setWindowState'>,
  get: () => Promise<WindowState | null> = getWindowState,
): Promise<void> {
  try {
    const state = await get()
    if (state) store.setWindowState(state)
  } catch (e) {
    console.error('Could not read the window state', e)
  }
}
