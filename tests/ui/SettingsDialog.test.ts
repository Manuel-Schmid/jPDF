import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'
import SettingsDialog, { type SettingsCategory, type UpdateControls } from '../../src/ui/SettingsDialog.svelte'
import { toasts } from '../../src/ui/toasts.svelte'

function setup(category: SettingsCategory = 'appearance', updates?: UpdateControls) {
  const save = vi.fn(async (_v: unknown) => {})
  const store = new SettingsStore({ load: async () => null, save }, createToolRegistry())
  const onclose = vi.fn()
  render(SettingsDialog, { props: { store, onclose, category, updates } })
  return { store, save, onclose }
}

const selectedTab = () =>
  screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim()

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SettingsDialog', () => {
  it('groups settings into six categories; clicking one shows only its panel', async () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Appearance', 'Files', 'Toolbar', 'Colours', 'AI (Beta)', 'Updates',
    ])
    expect(selectedTab()).toBe('Appearance')
    expect(screen.getByRole('tabpanel', { name: 'Appearance' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Reopen files' })).toBeNull()
    await fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    expect(selectedTab()).toBe('Files')
    expect(screen.getByRole('radiogroup', { name: 'Reopen files' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
  })

  it('arrow keys, Home and End move between categories', async () => {
    setup()
    const list = screen.getByRole('tablist')
    await fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(selectedTab()).toBe('Files')
    await fireEvent.keyDown(list, { key: 'ArrowUp' })
    await fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(selectedTab()).toBe('Updates')
    await fireEvent.keyDown(list, { key: 'Home' })
    expect(selectedTab()).toBe('Appearance')
    await fireEvent.keyDown(list, { key: 'End' })
    expect(selectedTab()).toBe('Updates')
  })

  it('has an AI (Beta) tab whose panel loads on demand', async () => {
    setup()
    await fireEvent.click(screen.getByRole('tab', { name: 'AI (Beta)' }))
    expect(selectedTab()).toBe('AI (Beta)')
    expect(screen.getByRole('tabpanel', { name: 'AI (Beta)' })).toBeTruthy()
    await vi.waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Page explanations' })).toBeTruthy())
  })

  it('shows the theme choice with Dark checked by default', () => {
    setup()
    const group = within(screen.getByRole('radiogroup', { name: 'Theme' }))
    expect(group.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    expect(group.getByRole('radio', { name: 'System' })).toBeTruthy()
  })

  it('picking a theme applies it to the store and saves', async () => {
    const { store, save } = setup()
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(store.data.preferences.theme).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
  })

  it('page colours: Original by default; Dark and Match theme apply and save', async () => {
    const { store, save } = setup()
    const group = screen.getByRole('radiogroup', { name: 'Page colours' })
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent?.trim())).toEqual(['Original', 'Dark', 'Match theme'])
    expect(screen.getByRole('radio', { name: 'Original' }).getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(screen.getByRole('radio', { name: 'Match theme' }))
    expect(store.data.preferences.pageColors).toBe('theme')
    await vi.runAllTimersAsync()
    expect(save.mock.calls.at(-1)![0]).toMatchObject({ preferences: { pageColors: 'theme' } })
  })

  it('shows the toolbar position with Right checked by default; picking one applies and saves', async () => {
    const { store, save } = setup()
    const group = screen.getByRole('radiogroup', { name: 'Toolbar position' })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((r) => r.textContent?.trim())).toEqual(['Right', 'Left', 'Top', 'Bottom'])
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(screen.getByRole('radio', { name: 'Top' }))
    expect(store.data.preferences.toolbarPosition).toBe('top')
    expect(screen.getByRole('radio', { name: 'Top' }).getAttribute('aria-checked')).toBe('true')
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0]).toMatchObject({ preferences: { toolbarPosition: 'top' } })
  })

  it('the close button, Escape and a click outside close it', async () => {
    const { onclose } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onclose).toHaveBeenCalledTimes(1)
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(onclose).toHaveBeenCalledTimes(2)
    await fireEvent.pointerDown(document.body)
    expect(onclose).toHaveBeenCalledTimes(3)
  })

  it('lists the tool presets with Default pressed on a fresh toolbar', async () => {
    const { store } = setup('toolbar')
    await store.load()
    const group = screen.getByRole('group', { name: 'Tool presets' })
    const names = [...group.querySelectorAll('.name')].map((n) => n.textContent)
    expect(names).toEqual(['Default', 'Taking lecture notes', 'Proofreading', 'Sketching and diagrams', 'Minimal'])
    const counts = [...group.querySelectorAll('.count')].map((n) => n.textContent)
    expect(counts).toEqual(['7 tools', '14 tools', '9 tools', '10 tools', '6 tools'])
    await vi.runAllTimersAsync()
    expect(screen.getByRole('button', { name: /^Default/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('picking a preset replaces the toolbar, saves, and its toast can undo it', async () => {
    const { store, save } = setup('toolbar')
    await store.load()
    const before = store.data.toolbar.map((i) => i.instanceId)
    await fireEvent.click(screen.getByRole('button', { name: /^Taking lecture notes/ }))
    expect(store.data.toolbar).toHaveLength(14)
    expect(screen.getByRole('button', { name: /^Taking lecture notes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Default/ }).getAttribute('aria-pressed')).toBe('false')
    const toast = toasts.items.at(-1)!
    expect(toast.message).toContain('Taking lecture notes')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    toast.action!.run()
    expect(store.data.toolbar.map((i) => i.instanceId)).toEqual(before)
  })

  it('Clear list empties the recent files and saves; disabled when there is none', async () => {
    const { store, save } = setup('files')
    const button = screen.getByRole('button', { name: 'Clear list' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('The start page lists no files.')).toBeTruthy()
    store.addRecentFile('C:\\a.pdf')
    await vi.runAllTimersAsync()
    save.mockClear()
    expect(button.disabled).toBe(false)
    expect(screen.getByText('1 file on the start page.')).toBeTruthy()
    await fireEvent.click(button)
    expect(store.data.recent).toEqual([])
    expect(button.disabled).toBe(true)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
  })

  it('update checks: Automatically by default; When I ask turns them off and saves', async () => {
    const { store, save } = setup('updates')
    expect(screen.getByRole('radiogroup', { name: 'Check for updates' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Automatically' }).getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(screen.getByRole('radio', { name: 'When I ask' }))
    expect(store.data.preferences.checkUpdates).toBe(false)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
  })

  it('shows the running version; Check now runs the check', async () => {
    const updates = { version: '1.0.3', checking: false, check: vi.fn() }
    setup('updates', updates)
    expect(screen.getByText('JuliePDF 1.0.3')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(updates.check).toHaveBeenCalledOnce()
  })

  it('Check now is disabled and says Checking… while a check runs', () => {
    setup('updates', { version: null, checking: true, check: vi.fn() })
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('no Check now button without the updater', () => {
    setup('updates')
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
  })

  it('draw with finger: Off by default; switching to On applies and saves', async () => {
    const { store, save } = setup('toolbar')
    const group = screen.getByRole('radiogroup', { name: 'Draw with finger' })
    expect(within(group).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(within(group).getByRole('radio', { name: 'On' }))
    expect(store.data.preferences.drawWithFinger).toBe(true)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0]).toMatchObject({ preferences: { drawWithFinger: true } })
  })

  it('pen buttons: side on Auto and eraser end on Eraser by default; each can be remapped', async () => {
    const { store } = setup('toolbar')
    const side = screen.getByRole('radiogroup', { name: 'Pen side button' })
    const end = screen.getByRole('radiogroup', { name: 'Pen eraser button' })
    expect(within(side).getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true')
    expect(within(end).getByRole('radio', { name: 'Eraser' }).getAttribute('aria-checked')).toBe('true')
    // The eraser end has no Auto of its own: it erases.
    expect(within(end).queryByRole('radio', { name: 'Auto' })).toBeNull()
    await fireEvent.click(within(side).getByRole('radio', { name: 'Lasso' }))
    await fireEvent.click(within(end).getByRole('radio', { name: 'Nothing' }))
    expect(store.data.preferences.penSideButton).toBe('lasso')
    expect(store.data.preferences.penEraserButton).toBe('none')
  })
})

describe('SettingsDialog look', () => {
  it('uses a wider Modal card (920px) than the other modals', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Settings' }).style.getPropertyValue('--card-max-width')).toBe('920px')
  })
})

describe('dialog text sizes (source)', () => {
  const read = (path: string) => readFileSync(path, 'utf8')
  const tokens = read('src/theme/tokens.css')
  const token = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1])

  it('the dialog tokens are at least the 13px base', () => {
    expect(token('font-size-dialog-hint')).toBeGreaterThanOrEqual(13)
    expect(token('font-size-dialog')).toBeGreaterThan(token('font-size-dialog-hint'))
    expect(token('font-size-dialog-title')).toBeGreaterThan(token('font-size-dialog'))
  })

  it.each(['src/ui/SettingsDialog.svelte', 'src/ai/AiSettingsPanel.svelte', 'src/app/UpdatePrompt.svelte'])(
    '%s sets no fixed font size below 13px',
    (path) => {
      const sizes = [...read(path).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
      expect(sizes.filter((px) => px < 13)).toEqual([])
    },
  )
})
