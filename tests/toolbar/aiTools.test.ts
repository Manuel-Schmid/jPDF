import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../src/core/registry/commands'
import { KeybindingRegistry } from '../../src/core/registry/keybindings'
import { toolAvailable } from '../../src/core/registry/tools'
import { ActiveTool, findTool } from '../../src/toolbar/activeTool.svelte'
import { addAiToolsOnce, AI_TOOLS_HINT, setAiEnabled } from '../../src/toolbar/aiTools'
import Toolbar from '../../src/toolbar/Toolbar.svelte'
import ToolPicker from '../../src/toolbar/ToolPicker.svelte'
import { registerToolShortcuts } from '../../src/toolbar/toolShortcuts'
import { fakeSetup, fakeTool } from './fakeTools'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Toolbar: select, pen and the AI tool (shortcut A); AI off. */
function setup(aiEnabled = false) {
  const s = fakeSetup([
    { instanceId: 's1', type: 'select', settings: {} },
    { instanceId: 'p1', type: 'pen', settings: {} },
    { instanceId: 'x1', type: 'explain', settings: {} },
  ])
  s.registry.register(fakeTool('select', { allowMultipleInstances: false, Options: null }))
  s.registry.register(fakeTool('explain', { allowMultipleInstances: false, Options: null, requiresAi: true, shortcut: 'a' }))
  s.store.setPreference('aiEnabled', aiEnabled)
  return s
}

const toolLabels = () =>
  within(screen.getByRole('toolbar')).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed')).map((b) => b.getAttribute('aria-label'))

describe('AI tools', () => {
  it('are available only while AI is on', () => {
    expect(toolAvailable({ requiresAi: true }, { aiEnabled: false })).toBe(false)
    expect(toolAvailable({ requiresAi: true }, { aiEnabled: true })).toBe(true)
    expect(toolAvailable({}, { aiEnabled: false })).toBe(true)
    const s = setup()
    expect(findTool(s.registry, 'explain', s.store.data.preferences)).toBeUndefined()
    expect(findTool(s.registry, 'explain')).toBeDefined()
  })

  it('AI off: not in the toolbar, not in the picker, the letter does nothing, never active', () => {
    const s = setup()
    render(Toolbar, { props: { registry: s.registry, store: s.store } })
    expect(toolLabels()).toEqual(['Select', 'Pen'])

    const cmds = new CommandRegistry()
    registerToolShortcuts(s.registry, s.store, cmds, new KeybindingRegistry())
    expect(cmds.canExecute('tool.explain')).toBe(false)

    s.store.data.activeInstanceId = 'x1'
    expect(new ActiveTool(s.store, s.registry).current).toBeNull()
  })

  it('AI on: shown, its letter selects it, and the picker offers it once removed', async () => {
    const s = setup(true)
    render(Toolbar, { props: { registry: s.registry, store: s.store } })
    expect(toolLabels()).toEqual(['Select', 'Pen', 'Explain'])
    const cmds = new CommandRegistry()
    registerToolShortcuts(s.registry, s.store, cmds, new KeybindingRegistry())
    await cmds.execute('tool.explain')
    expect(s.store.data.activeInstanceId).toBe('x1')
  })

  it('the picker lists AI tools only while AI is on', () => {
    const s = setup()
    s.store.data.toolbar = s.store.data.toolbar.filter((i) => i.type !== 'explain')
    const r = render(ToolPicker, { props: { registry: s.registry, store: s.store, onpick: () => {}, onclose: () => {} } })
    expect(screen.queryByText('Explain')).toBeNull()
    r.unmount()
    s.store.setPreference('aiEnabled', true)
    render(ToolPicker, { props: { registry: s.registry, store: s.store, onpick: () => {}, onclose: () => {} } })
    expect(screen.getByText('Explain')).toBeTruthy()
  })

  it('turning AI on adds missing AI tools; turning it off hands an active one over to Select', async () => {
    const s = setup()
    s.store.data.toolbar = s.store.data.toolbar.filter((i) => i.type !== 'explain')
    setAiEnabled(s.store, true, s.registry)
    expect(s.store.data.preferences.aiEnabled).toBe(true)
    const added = s.store.data.toolbar.find((i) => i.type === 'explain')!
    expect(added).toBeTruthy()
    expect(s.store.data.hints[AI_TOOLS_HINT]).toBe(true)

    s.store.setActive(added.instanceId)
    setAiEnabled(s.store, false, s.registry)
    expect(s.store.data.activeInstanceId).toBe('s1')
    // Kept in the settings, just hidden.
    expect(s.store.data.toolbar.some((i) => i.type === 'explain')).toBe(true)
  })

  it('a user who already had AI on gets the tools once; removing one afterwards sticks', () => {
    const s = setup(true)
    s.store.data.toolbar = s.store.data.toolbar.filter((i) => i.type !== 'explain')
    addAiToolsOnce(s.store, s.registry)
    expect(s.store.data.toolbar.filter((i) => i.type === 'explain')).toHaveLength(1)
    s.store.data.toolbar = s.store.data.toolbar.filter((i) => i.type !== 'explain')
    addAiToolsOnce(s.store, s.registry)
    expect(s.store.data.toolbar.some((i) => i.type === 'explain')).toBe(false)
    // AI off: nothing is added.
    const off = setup(false)
    off.store.data.toolbar = off.store.data.toolbar.filter((i) => i.type !== 'explain')
    addAiToolsOnce(off.store, off.registry)
    expect(off.store.data.toolbar.some((i) => i.type === 'explain')).toBe(false)
  })

  it('a click on the toolbar never reaches a hidden AI tool', async () => {
    const s = setup()
    render(Toolbar, { props: { registry: s.registry, store: s.store } })
    for (const b of within(screen.getByRole('toolbar')).getAllByRole('button')) {
      if (b.hasAttribute('aria-pressed')) await fireEvent.click(b)
    }
    expect(s.store.data.activeInstanceId).not.toBe('x1')
  })
})
