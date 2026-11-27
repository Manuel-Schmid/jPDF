import { commands as defaultCommands, type CommandRegistry } from '../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../core/registry/keybindings'
import { toolAvailable, toolRegistry, type ToolRegistry } from '../core/registry/tools'
import { settings as defaultSettings, type SettingsStore, type ToolInstance } from '../core/settings/settings.svelte'

/**
 * Instance a tool's letter shortcut selects: the first instance of `type`, or,
 * when an instance of `type` is already active, the next one (wrapping).
 */
export function nextInstanceOfType(toolbar: ToolInstance[], activeId: string | null, type: string): string | null {
  const ofType = toolbar.filter((i) => i.type === type)
  if (ofType.length === 0) return null
  const i = ofType.findIndex((t) => t.instanceId === activeId)
  return ofType[(i + 1) % ofType.length].instanceId
}

/**
 * Instance Shift + a tool's letter selects: the last instance of `type`, or,
 * when an instance of `type` is already active, the previous one (wrapping).
 */
export function previousInstanceOfType(toolbar: ToolInstance[], activeId: string | null, type: string): string | null {
  const ofType = toolbar.filter((i) => i.type === type)
  if (ofType.length === 0) return null
  const i = ofType.findIndex((t) => t.instanceId === activeId)
  // Not active (-1) lands on the last instance, like the first one cycling back.
  return ofType[(i < 1 ? ofType.length : i) - 1].instanceId
}

/**
 * Registers, for every registered tool that has a `shortcut` letter, a
 * `tool.<type>` command bound to the upper-case letter (next instance) and a
 * `tool.<type>.previous` command bound to Shift+letter (previous instance).
 * Tools register at import time, so call this once after all tool modules are
 * imported (App does it on mount); tools registered later need another call.
 * Returns a disposer.
 */
export function registerToolShortcuts(
  registry: ToolRegistry = toolRegistry,
  store: SettingsStore = defaultSettings,
  cmds: CommandRegistry = defaultCommands,
  keys: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = registry.list().flatMap((def) => {
    if (!def.shortcut) return []
    const letter = def.shortcut.toUpperCase()
    const select = (id: string, title: string, chord: string, pick: typeof nextInstanceOfType) => {
      // An AI tool's letter does nothing while AI is off.
      const target = () =>
        toolAvailable(def, store.data.preferences) ? pick(store.data.toolbar, store.data.activeInstanceId, def.type) : null
      return [
        cmds.register({
          id,
          title,
          enabled: () => target() !== null,
          run: () => {
            const next = target()
            if (next) store.setActive(next)
          },
        }),
        keys.bind(chord, id),
      ]
    }
    return [
      ...select(`tool.${def.type}`, `Select ${def.displayName}`, letter, nextInstanceOfType),
      ...select(`tool.${def.type}.previous`, `Select previous ${def.displayName}`, `Shift+${letter}`, previousInstanceOfType),
    ]
  })
  return () => disposers.forEach((d) => d())
}
