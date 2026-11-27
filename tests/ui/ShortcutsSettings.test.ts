import { render, screen, within } from '@testing-library/svelte'
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

  it('leaves out a tool that is unavailable (an AI tool while AI is off)', () => {
    setup(
      ['explain'],
      [{ type: 'explain', displayName: 'AI Explain', shortcut: 'A', requiresAi: true }],
    )
    expect(section('Tools').queryByText('AI Explain')).toBeNull()
  })
})
