import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
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

  it('Codex with a failed list has one "CLI default" and still offers the effort', async () => {
    ipc.cliModels.mockRejectedValue({ code: 'AiCli', message: 'boom' })
    const store = setup()
    store.setPreference('aiCli', 'codex')
    await screen.findByText(/Could not load the model list/)
    expect(screen.getAllByRole('option', { name: 'CLI default' }).length).toBe(2) // model + effort selects
    expect(within(screen.getByLabelText('Model')).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByLabelText('Effort')).toBeTruthy()
  })

  it('opus (medium) -> haiku -> sonnet ends at medium again', async () => {
    ipc.cliModels.mockResolvedValue([...CLAUDE, m('sonnet', 'Sonnet', '', ['low', 'medium', 'high'])])
    const store = setup()
    store.setPreference('aiClaudeModel', 'opus')
    store.setPreference('aiClaudeEffort', 'medium')
    await screen.findByRole('option', { name: /Haiku/ })
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'haiku' } })
    expect(store.data.preferences.aiClaudeEffort).toBe('')
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'sonnet' } })
    expect(store.data.preferences.aiClaudeEffort).toBe('medium')
  })

  it('a cleared Claude effort is not restored by a Codex model', async () => {
    ipc.cliModels.mockImplementation(async (cli: string) =>
      cli === 'codex' ? [m('gpt-a', 'A', '', ['low', 'high'])] : CLAUDE,
    )
    const store = setup()
    store.setPreference('aiClaudeModel', 'opus')
    store.setPreference('aiClaudeEffort', 'high')
    await screen.findByRole('option', { name: /Haiku/ })
    // Haiku has no effort: "high" is cleared and remembered.
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'haiku' } })
    expect(store.data.preferences.aiClaudeEffort).toBe('')
    store.setPreference('aiCodexEffort', '')
    await fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    await screen.findByRole('option', { name: /^A$/ })
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-a' } })
    expect(store.data.preferences.aiCodexModel).toBe('gpt-a')
    expect(store.data.preferences.aiCodexEffort).toBe('')
  })

  it('an unsupported effort becomes medium when the new model has it; a hand-typed model changes nothing', async () => {
    ipc.cliModels.mockResolvedValue([m('opus', 'Opus', '', ['low', 'medium', 'max']), m('x', 'X', '', ['low', 'medium'])])
    const store = setup()
    store.setPreference('aiClaudeEffort', 'max')
    await screen.findByRole('option', { name: /Opus/ })
    await fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'x' } })
    expect(store.data.preferences.aiClaudeEffort).toBe('medium')
  })

  it('the Test result is cleared when the configuration changes', async () => {
    gen.generate.mockImplementation(async (_r, onLine) => {
      onLine('{"page": 1, "text": "ok"}')
      return 'done'
    })
    setup()
    await screen.findByRole('option', { name: 'Opus — Most capable' })
    await fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Works')).toBeTruthy()
    await fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'high' } })
    await vi.waitFor(() => expect(screen.queryByText('Works')).toBeNull())
  })

  it('shows "CLI default" for a stored effort the list does not offer, without rewriting it', async () => {
    const store = setup()
    store.setPreference('aiClaudeModel', 'claude-sonnet-4-6')
    store.setPreference('aiClaudeEffort', 'max')
    await screen.findByRole('option', { name: /claude-sonnet-4-6/ })
    expect((screen.getByLabelText('Effort') as HTMLSelectElement).value).toBe('')
    expect(store.data.preferences.aiClaudeEffort).toBe('max')
  })
})
