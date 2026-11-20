import { vi } from 'vitest'
import { createToolRegistry, type ToolDefinition } from '../../src/core/registry/tools'
import { defaultPreferences, type ToolbarPosition } from '../../src/core/settings/preferences'
import { SettingsStore, type Settings } from '../../src/core/settings/settings.svelte'
import FakeIcon from './FakeIcon.svelte'
import FakeOptions from './FakeOptions.svelte'

export function fakeTool(type: string, over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    type,
    displayName: type[0].toUpperCase() + type.slice(1),
    description: `${type} description`,
    Icon: FakeIcon,
    defaultSettings: { width: 2 },
    Options: FakeOptions,
    allowMultipleInstances: true,
    createHandler: () => ({}),
    ...over,
  }
}

/**
 * Registry with `pen` (multi-instance, shortcut P) and `hand` (single, no
 * options, shortcut H); the toolbar at `toolbarPosition` (right by default).
 */
export function fakeSetup(
  toolbar: Settings['toolbar'] = [
    { instanceId: 'p1', type: 'pen', settings: { width: 2, color: [1, 0, 0] } },
    { instanceId: 'h1', type: 'hand', settings: {} },
  ],
  toolbarPosition: ToolbarPosition = 'right',
) {
  const registry = createToolRegistry()
  registry.register(fakeTool('pen', { shortcut: 'p' }))
  registry.register(fakeTool('hand', { allowMultipleInstances: false, Options: null, shortcut: 'h' }))
  const ipc = { load: vi.fn(async () => null), save: vi.fn(async () => {}) }
  const store = new SettingsStore(ipc, registry)
  store.data = {
    version: 2,
    author: 'JuliePDF',
    toolbar,
    activeInstanceId: toolbar[0]?.instanceId ?? null,
    hints: {},
    preferences: { ...defaultPreferences(), toolbarPosition },
  }
  return { registry, store, ipc }
}
