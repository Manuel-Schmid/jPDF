import { toolRegistry, type ToolRegistry } from '../core/registry/tools'
import type { SettingsStore } from '../core/settings/settings.svelte'
import { activateSelectTool } from './toolLock'

/**
 * AI tools (ToolDefinition.requiresAi) follow the AI switch: turning AI on
 * adds them to the toolbar, turning it off hides them (see toolAvailable) and
 * hands an active one over to Select. Their instances stay in the settings
 * meanwhile, so the toolbar is as the user left it when AI comes back.
 */

/** Set once AI tools were added for a user who had AI on already when they arrived (see addAiToolsOnce). */
export const AI_TOOLS_HINT = 'aiToolsAdded'

const aiTypes = (registry: ToolRegistry) => registry.list().filter((d) => d.requiresAi).map((d) => d.type)

/** Adds every AI tool the toolbar lacks, at its end. */
function addMissing(store: SettingsStore, registry: ToolRegistry): void {
  for (const type of aiTypes(registry)) {
    if (!store.data.toolbar.some((i) => i.type === type)) store.addInstance(type)
  }
}

/** The AI switch of Settings → AI. */
export function setAiEnabled(store: SettingsStore, on: boolean, registry: ToolRegistry = toolRegistry): void {
  if (!on) {
    const active = store.data.toolbar.find((i) => i.instanceId === store.data.activeInstanceId)
    if (active && aiTypes(registry).includes(active.type)) activateSelectTool(store)
  }
  store.setPreference('aiEnabled', on)
  if (on) {
    addMissing(store, registry)
    store.setHint(AI_TOOLS_HINT)
  }
}

/**
 * At startup: a user who had AI on before AI tools existed gets them added,
 * once. After that, removing one from the toolbar sticks (until AI is turned
 * off and on again).
 */
export function addAiToolsOnce(store: SettingsStore, registry: ToolRegistry = toolRegistry): void {
  if (!store.data.preferences.aiEnabled || store.data.hints[AI_TOOLS_HINT]) return
  addMissing(store, registry)
  store.setHint(AI_TOOLS_HINT)
}
