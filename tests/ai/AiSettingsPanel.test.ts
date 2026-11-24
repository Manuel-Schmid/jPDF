import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliModel } from '../../src/ai/cliIpc'

const ipc = vi.hoisted(() => ({
  cliInfo: vi.fn(async (_cli: string, _path: string) => ({ found: true, path: 'C:\\bin\\claude.exe', version: '2.1.331' as string | null })),
  cliModels: vi.fn(async (_cli: string, _path: string): Promise<unknown[]> => []),
}))
vi.mock('../../src/ai/cliIpc', () => ipc)
const gen = vi.hoisted(() => ({
  generate: vi.fn(async (_req: unknown, _onLine: (l: string) => void, _signal: AbortSignal): Promise<string> => 'done'),
}))
vi.mock('../../src/ai/cliGenerator', () => ({ cliGenerator: vi.fn(() => ({ model: 'x', generate: gen.generate })) }))

import AiSettingsPanel, { resetAiCache } from '../../src/ai/AiSettingsPanel.svelte'
import { createToolRegistry } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'

const m = (value: string, label: string, description: string, efforts: string[]): CliModel => ({
  value, label, description, efforts, isDefault: false,
})
const CLAUDE = [
  m('default', 'Default', 'Opus 5.5 · Best for everyday', ['low', 'medium', 'high', 'max']),
  m('opus', 'Opus', 'Most capable', ['low', 'medium', 'high', 'max']),
  m('haiku', 'Haiku', 'Fastest', []),
  m('claude-sonnet-4-6', 'claude-sonnet-4-6', '', ['low', 'high']),
]

function setup(enabled = true) {
  const store = new SettingsStore({ load: async () => null, save: async () => {} }, createToolRegistry())
  store.setPreference('aiEnabled', enabled)
  render(AiSettingsPanel, { props: { store } })
  return store
}

beforeEach(() => {
  resetAiCache()
  ipc.cliInfo.mockClear()
  ipc.cliModels.mockReset().mockResolvedValue(CLAUDE)
  gen.generate.mockReset().mockResolvedValue('done')
})

describe('Settings → AI panel', () => {
  it('is off by default: only the switch, and the CLI is not touched', () => {
    setup(false)
    expect(screen.getByRole('radiogroup', { name: 'Page explanations' })).toBeTruthy()
    expect(screen.queryByLabelText('Model')).toBeNull()
    expect(ipc.cliInfo).not.toHaveBeenCalled()
    expect(ipc.cliModels).not.toHaveBeenCalled()
  })

  it('turning it on shows the CLI, status, models with descriptions and the effort', async () => {
    const store = setup(false)
    await fireEvent.click(screen.getByRole('radio', { name: 'On' }))
    expect(store.data.preferences.aiEnabled).toBe(true)
    expect(await screen.findByText(/Claude Code 2\.1\.331 found/)).toBeTruthy()
    expect(await screen.findByRole('option', { name: /Default — Opus 5\.5/ })).toBeTruthy()
    const more = screen.getByRole('group', { name: 'More versions' })
    expect(more.textContent).toContain('claude-sonnet-4-6')
    expect(screen.getByLabelText('Effort')).toBeTruthy()
  })

  it('selecting haiku hides the effort and clears an effort it does not offer', async () => {
    const store = setup()
    await screen.findByRole('option', { name: /Haiku/ })
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'haiku' } })
    expect(store.data.preferences.aiClaudeModel).toBe('haiku')
    expect(store.data.preferences.aiClaudeEffort).toBe('')
    expect(screen.queryByLabelText('Effort')).toBeNull()
  })

  it('reports a missing CLI and saves a custom path', async () => {
    ipc.cliInfo.mockResolvedValueOnce({ found: false, path: null, version: null })
    const store = setup()
    expect(await screen.findByText(/Claude Code was not found/)).toBeTruthy()
    const input = screen.getByLabelText(/Path to claude\.exe/)
    await fireEvent.change(input, { target: { value: '  C:\\tools\\claude.exe ' } })
    expect(store.data.preferences.aiClaudePath).toBe('C:\\tools\\claude.exe')
    await vi.waitFor(() => expect(ipc.cliInfo).toHaveBeenCalledWith('claude', 'C:\\tools\\claude.exe'))
  })

  it('Codex lists a "CLI default" first', async () => {
    ipc.cliModels.mockResolvedValue([{ ...m('gpt-6.2-sol', 'GPT-6.2-Sol', '', ['low', 'max']), isDefault: true }])
    const store = setup()
    store.setPreference('aiCli', 'codex')
    const opts = await screen.findAllByRole('option', { name: /CLI default|GPT-6\.2-Sol/ })
    expect(opts[0].textContent).toBe('CLI default')
  })

  it('a failed model list shows the fallback note and a text field', async () => {
    ipc.cliModels.mockRejectedValue({ code: 'AiCli', message: 'boom' })
    const store = setup()
    expect(await screen.findByText('Could not load the model list from the CLI; showing common choices.')).toBeTruthy()
    await fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'my-model' } })
    expect(store.data.preferences.aiClaudeModel).toBe('my-model')
  })

  it('shows the disclaimer', () => {
    setup()
    expect(screen.getByRole('note').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Uses your own Claude or ChatGPT subscription through its command-line tool. Use at your own risk: the provider may not allow this, and may limit or stop it. The document's text is sent to the provider when you generate.",
    )
  })

  it('does not spawn the CLI again when the page is reopened', async () => {
    setup()
    await screen.findByText(/found/)
    cleanup()
    setup()
    await screen.findByText(/found/)
    expect(ipc.cliInfo).toHaveBeenCalledTimes(1)
    expect(ipc.cliModels).toHaveBeenCalledTimes(1)
  })

  it('Test shows Works when an answer line arrives', async () => {
    gen.generate.mockImplementation(async (_r, onLine) => {
      onLine('{"page": 1, "text": "Water circulates."}')
      return 'done'
    })
    setup()
    await screen.findByText(/found/)
    await fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Works')).toBeTruthy()
  })

  it('Test shows the error message on rejection', async () => {
    gen.generate.mockRejectedValue({ code: 'AiCli', message: 'Claude Code is not signed in.' })
    setup()
    await screen.findByText(/found/)
    await fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Claude Code is not signed in.')).toBeTruthy()
  })
})
