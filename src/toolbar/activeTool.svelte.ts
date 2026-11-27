import { toolAvailable, toolRegistry, type ToolDefinition, type ToolRegistry } from '../core/registry/tools'
import { settings, type SettingsStore, type ToolInstance } from '../core/settings/settings.svelte'

export interface ActiveToolValue {
  def: ToolDefinition
  instance: ToolInstance
}

/**
 * Finds a registered definition without throwing (the registry itself is not
 * reactive). With `prefs`, a tool the user cannot have now (an AI tool while
 * AI is off, see toolAvailable) counts as not found.
 */
export function findTool(registry: ToolRegistry, type: string, prefs?: { aiEnabled: boolean }): ToolDefinition | undefined {
  const def = registry.list().find((d) => d.type === type)
  return def && (!prefs || toolAvailable(def, prefs)) ? def : undefined
}

/**
 * The active tool instance paired with its definition; null when nothing is
 * active, the active instance's type is not registered, or it is an AI tool
 * while AI is off.
 */
export class ActiveTool {
  readonly current: ActiveToolValue | null = $derived.by(() => {
    const { toolbar, activeInstanceId } = this.store.data
    const instance = toolbar.find((i) => i.instanceId === activeInstanceId)
    const def = instance && findTool(this.registry, instance.type, this.store.data.preferences)
    return instance && def ? { def, instance } : null
  })

  constructor(
    private store: SettingsStore = settings,
    private registry: ToolRegistry = toolRegistry,
  ) {}
}

export const activeTool = new ActiveTool()
