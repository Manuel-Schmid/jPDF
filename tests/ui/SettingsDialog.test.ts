import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'
import SettingsDialog from '../../src/ui/SettingsDialog.svelte'
import { toasts } from '../../src/ui/toasts.svelte'

function setup() {
  const save = vi.fn(async (_v: unknown) => {})
  const store = new SettingsStore({ load: async () => null, save }, createToolRegistry())
  const onclose = vi.fn()
  render(SettingsDialog, { props: { store, onclose } })
  return { store, save, onclose }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SettingsDialog', () => {
  it('shows the theme choice with Dark checked by default', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Follow Windows' })).toBeTruthy()
  })

  it('picking a theme applies it to the store and saves', async () => {
    const { store, save } = setup()
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(store.data.preferences.theme).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledOnce()
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
    const { store } = setup()
    await store.load()
    const group = screen.getByRole('group', { name: 'Tool preset' })
    const names = [...group.querySelectorAll('.name')].map((n) => n.textContent)
    expect(names).toEqual(['Default', 'Taking lecture notes', 'Proofreading', 'Sketching and diagrams', 'Minimal'])
    const counts = [...group.querySelectorAll('.count')].map((n) => n.textContent)
    expect(counts).toEqual(['7 tools', '12 tools', '8 tools', '10 tools', '5 tools'])
    await vi.runAllTimersAsync()
    expect(screen.getByRole('button', { name: /^Default/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('picking a preset replaces the toolbar, saves, and its toast can undo it', async () => {
    const { store, save } = setup()
    await store.load()
    const before = store.data.toolbar.map((i) => i.instanceId)
    await fireEvent.click(screen.getByRole('button', { name: /^Taking lecture notes/ }))
    expect(store.data.toolbar).toHaveLength(12)
    expect(screen.getByRole('button', { name: /^Taking lecture notes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Default/ }).getAttribute('aria-pressed')).toBe('false')
    const toast = toasts.items.at(-1)!
    expect(toast.message).toContain('Taking lecture notes')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    toast.action!.run()
    expect(store.data.toolbar.map((i) => i.instanceId)).toEqual(before)
  })
})
