import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  aiHasKey: vi.fn(async (_provider: string) => false),
  aiSetKey: vi.fn(async (_provider: string, _key: string) => {}),
  aiTest: vi.fn(async (_config: unknown) => {}),
}))
vi.mock('../../src/ai/ipc', () => ipc)

import { createToolRegistry } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'
import SettingsDialog from '../../src/ui/SettingsDialog.svelte'

function setup() {
  const save = vi.fn(async (_v: unknown) => {})
  const store = new SettingsStore({ load: async () => null, save }, createToolRegistry())
  render(SettingsDialog, { props: { store, onclose: vi.fn(), category: 'ai' } })
  return { store, save }
}

beforeEach(() => {
  ipc.aiHasKey.mockClear()
  ipc.aiSetKey.mockClear()
  ipc.aiTest.mockClear()
})

describe('Settings → AI (Beta)', () => {
  it('is off by default and touches no key while off', () => {
    const { store } = setup()
    expect(store.data.preferences.aiEnabled).toBe(false)
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByLabelText('API key')).toBeNull()
    expect(ipc.aiHasKey).not.toHaveBeenCalled()
  })

  it('turning it on shows the data-sharing note and looks up the stored key', async () => {
    const { store } = setup()
    await fireEvent.click(screen.getByRole('radio', { name: 'On' }))
    expect(store.data.preferences.aiEnabled).toBe(true)
    expect(screen.getByRole('note').textContent).toMatch(/sends the document's text/)
    expect(screen.getByRole('note').textContent).toMatch(/train/)
    await vi.waitFor(() => expect(ipc.aiHasKey).toHaveBeenCalledWith('gemini'))
    expect(await screen.findByText(/No key stored/)).toBeTruthy()
  })

  it('a preset fills in its base URL and model', async () => {
    const { store } = setup()
    store.setPreference('aiEnabled', true)
    await fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'groq' } })
    expect(store.data.preferences.aiProvider).toBe('groq')
    expect(store.data.preferences.aiBaseUrl).toBe('https://api.groq.com/openai/v1')
    expect(store.data.preferences.aiModel).toBe('llama-3.3-70b-versatile')
  })

  it('saves the key to the Credential Manager, never into the settings', async () => {
    const { store, save } = setup()
    store.setPreference('aiEnabled', true)
    ipc.aiHasKey.mockResolvedValueOnce(false).mockResolvedValue(true)
    const input = (await screen.findByLabelText('API key')) as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'secret-key-123' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(ipc.aiSetKey).toHaveBeenCalledWith('gemini', 'secret-key-123'))
    expect(await screen.findByText(/Key saved/)).toBeTruthy()
    expect(input.value).toBe('')
    await store.flush()
    expect(JSON.stringify(store.data)).not.toContain('secret-key-123')
    expect(JSON.stringify(save.mock.calls)).not.toContain('secret-key-123')
  })

  it('Test checks the stored key with the configured endpoint', async () => {
    const { store } = setup()
    ipc.aiHasKey.mockResolvedValue(true)
    store.setPreference('aiEnabled', true)
    const test = await screen.findByRole('button', { name: 'Test' })
    await vi.waitFor(() => expect((test as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(test)
    await vi.waitFor(() =>
      expect(ipc.aiTest).toHaveBeenCalledWith({
        provider: 'gemini', baseUrl: store.data.preferences.aiBaseUrl, model: store.data.preferences.aiModel,
      }),
    )
    expect(await screen.findByText('The key works.')).toBeTruthy()
  })
})
