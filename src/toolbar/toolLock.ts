import type { ToolDefinition } from '../core/registry/tools'
import { SELECT_TOOL, type SettingsStore, type ToolInstance } from '../core/settings/settings.svelte'

/** Whether the tool has a lock to toggle (see ToolDefinition.defaultLocked). */
export function isLockable(def: ToolDefinition): boolean {
  return def.defaultLocked !== undefined
}

/** Whether `instance` stays active after each use: its own choice, else the tool's default; tools without a lock always do. */
export function isLocked(def: ToolDefinition, instance: ToolInstance): boolean {
  if (!isLockable(def)) return true
  return instance.locked ?? def.defaultLocked!
}

/**
 * Activates the select tool: stays on the active instance if it is one, else
 * the first in the toolbar. Without a select tool in the toolbar nothing changes.
 */
export function activateSelectTool(store: SettingsStore): void {
  const { toolbar, activeInstanceId } = store.data
  const active = toolbar.find((i) => i.instanceId === activeInstanceId)
  if (active?.type === SELECT_TOOL) return
  const target = toolbar.find((i) => i.type === SELECT_TOOL)
  if (target) store.setActive(target.instanceId)
}

/** The active tool was used once: an unlocked one hands over to the select tool. */
export function afterToolUse(active: { def: ToolDefinition; instance: ToolInstance } | null, store: SettingsStore): void {
  if (active && !isLocked(active.def, active.instance)) activateSelectTool(store)
}
