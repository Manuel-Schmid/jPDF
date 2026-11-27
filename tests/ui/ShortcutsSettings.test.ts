import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { createToolRegistry, type ToolDefinition } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'
import ShortcutsSettings from '../../src/ui/ShortcutsSettings.svelte'

/** A registry with just enough of each tool for the list. */
function registryOf(defs: Partial<ToolDefinition>[]) {
  const r = createToolRegistry()
  for (const d of defs) r.register(d as ToolDefinition)
  return r
}

function setup(toolbarTypes: string[], defs: Partial<ToolDefinition>[]) {
  const registry = registryOf(defs)
  const store = new SettingsStore({ load: async () => null, save: vi.fn(async () => {}) }, registry)
  store.data.toolbar = toolbarTypes.map((type, i) => ({ instanceId: `i${i}`, type, settings: {} }))
  render(ShortcutsSettings, { props: { store, registry } })
  return store
}

/** Starts recording a key for `label` and presses `init`. */
async function record(label: string, init: KeyboardEventInit) {
  await fireEvent.click(screen.getByRole('button', { name: `Add a key to ${label}` }))
  await fireEvent.keyDown(window, init)
}

const section = (name: string) => within(screen.getByRole('region', { name }))

describe('ShortcutsSettings', () => {
  it('lists every group with its shortcuts as key caps', () => {
    setup([], [])
    for (const name of [
      'Files & tabs',
      'View & navigation',
      'Selection & editing',
      'Tools',
      'Study',
      'Document builder',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }
    const view = section('View & navigation')
    expect(view.getByText('Page thumbnails')).toBeTruthy()
    expect(view.getByText('Ctrl+B: no text box selected')).toBeTruthy()
    // Ctrl+B or F4, as key caps.
    const row = view.getByText('Page thumbnails').closest('.shortcut') as HTMLElement
    expect([...row.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'B', 'F4'])
  })

  it('shows the letters of the toolbar tools only, each once and in toolbar order', () => {
    setup(
      ['marker', 'pen', 'marker', 'eraser'],
      [
        { type: 'pen', displayName: 'Pen', shortcut: 'P' },
        { type: 'marker', displayName: 'Marker', shortcut: 'M' },
        { type: 'eraser', displayName: 'Eraser', shortcut: 'E' },
        { type: 'lasso', displayName: 'Lasso', shortcut: 'L' },
      ],
    )
    const tools = section('Tools')
    const labels = tools.getAllByText(/^(Pen|Marker|Eraser|Lasso)$/).map((e) => e.textContent)
    expect(labels).toEqual(['Marker', 'Pen', 'Eraser'])
  })

  it('the intro names the keys that open the list, as the catalog has them', () => {
    setup([], [])
    const intro = screen.getByText(/anywhere to open this list/)
    expect([...intro.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['F1'])
  })

  it('leaves out a tool that is unavailable (an AI tool while AI is off)', () => {
    setup(
      ['explain'],
      [{ type: 'explain', displayName: 'AI Explain', shortcut: 'A', requiresAi: true }],
    )
    expect(section('Tools').queryByText('AI Explain')).toBeNull()
  })
})

describe('ShortcutsSettings editing', () => {
  const pen = [{ type: 'pen', displayName: 'Pen', shortcut: 'P' }]

  it('records a key and saves it as a change', async () => {
    const store = setup([], [])
    await record('Fit width', { key: 'k', ctrlKey: true })
    expect(store.data.preferences.shortcutOverrides).toEqual({
      'view.fitWidth': ['Ctrl+0', 'Ctrl+K'],
    })
    expect(screen.getByRole('button', { name: 'Remove Ctrl+K from Fit width' })).toBeTruthy()
  })

  it('waits past a modifier for the key, and Escape cancels without a change', async () => {
    const store = setup([], [])
    await fireEvent.click(screen.getByRole('button', { name: 'Add a key to Fit width' }))
    await fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect(screen.getByRole('button', { name: /Press a key/ })).toBeTruthy()
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Press a key/ })).toBeNull()
    expect(store.data.preferences.shortcutOverrides).toEqual({})
  })

  it('refuses a tool letter and a reserved key, saying why', async () => {
    const store = setup(['pen'], pen)
    await record('Fit width', { key: 'p' })
    expect(screen.getByRole('status').textContent).toMatch(/Pen tool/)
    await record('Fit width', { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toMatch(/kept/)
    expect(store.data.preferences.shortcutOverrides).toEqual({})
  })

  it('asks before taking a key from another command; Replace moves it', async () => {
    const store = setup([], [])
    await record('Fit width', { key: 'f', ctrlKey: true })
    expect(screen.getByRole('alert').textContent).toMatch(/Ctrl\+F is used by “Find”/)
    expect(store.data.preferences.shortcutOverrides).toEqual({})
    await fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(store.data.preferences.shortcutOverrides).toEqual({
      'view.fitWidth': ['Ctrl+0', 'Ctrl+F'],
      'view.find': [],
    })
  })

  it('Cancel keeps both as they were', async () => {
    const store = setup([], [])
    await record('Fit width', { key: 'f', ctrlKey: true })
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(store.data.preferences.shortcutOverrides).toEqual({})
  })

  it('removes a key, and resets the command to its default', async () => {
    const store = setup([], [])
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Ctrl+F from Find' }))
    expect(store.data.preferences.shortcutOverrides).toEqual({ 'view.find': [] })
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Find to its default keys' }))
    expect(store.data.preferences.shortcutOverrides).toEqual({})
  })

  it('Reset all clears every change; the button is off without changes', async () => {
    const store = setup([], [])
    const resetAll = screen.getByRole('button', {
      name: 'Reset all shortcuts',
    }) as HTMLButtonElement
    expect(resetAll.disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Ctrl+F from Find' }))
    expect(resetAll.disabled).toBe(false)
    await fireEvent.click(resetAll)
    expect(store.data.preferences.shortcutOverrides).toEqual({})
  })

  it('the intro follows a changed key that opens the list, and drops the hint when it has none', async () => {
    const store = setup([], [])
    await record('Keyboard shortcuts', { key: 'j', ctrlKey: true })
    const intro = () => screen.getByText(/to remove one/)
    expect([...intro().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['F1', 'Ctrl', 'J'])
    store.setPreference('shortcutOverrides', { 'app.shortcuts': [] })
    await Promise.resolve()
    expect(intro().textContent).not.toMatch(/open this list/)
  })

  it('fixed shortcuts and tool letters have no editing controls', () => {
    setup(['pen'], pen)
    expect(screen.queryByRole('button', { name: /Add a key to Pan the page/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a key to Pen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a key to Find' })).toBeTruthy()
  })
})
