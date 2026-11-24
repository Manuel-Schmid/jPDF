import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliConfig } from '../../src/ai/cliIpc'
import { generationRuns } from '../../src/ai/runs.svelte'
import { retryGeneration, startGeneration } from '../../src/ai/startGeneration'
import type { DocumentSession } from '../../src/core/session/session.svelte'

const generateExplanations = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
vi.mock('../../src/ai/generate', () => ({ generateExplanations }))
vi.mock('../../src/ai/cliGenerator', async (orig) => ({
  ...(await orig<typeof import('../../src/ai/cliGenerator')>()),
  cliGenerator: vi.fn(() => ({ tag: 'generator' })),
}))

const codex: CliConfig = { cli: 'codex', path: '', model: '', effort: 'medium' }
const claude: CliConfig = { cli: 'claude', path: '', model: 'opus', effort: 'medium' }
const ex = { text: 'x', model: 'm', createdAt: 't' }
const session = (explanations: unknown[]) => ({ id: 's1', explanations }) as unknown as DocumentSession
const optionsOf = (call: number) => generateExplanations.mock.calls[call]![2] as { limits: { maxPages: number }; pages?: number[] }

afterEach(() => {
  generateExplanations.mockClear()
  generationRuns.clear('s1')
})

describe('startGeneration', () => {
  it('runs straight away when nothing is explained yet, without asking', async () => {
    const confirm = vi.fn(async () => true)
    await startGeneration(session([null]), claude, { confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(generateExplanations).toHaveBeenCalledOnce()
  })

  it('asks before regenerating and does nothing on "no"', async () => {
    const confirm = vi.fn(async () => false)
    await startGeneration(session([ex]), claude, { confirm })
    expect(confirm).toHaveBeenCalledOnce()
    expect(generateExplanations).not.toHaveBeenCalled()
  })

  it('regenerates after a "yes"', async () => {
    await startGeneration(session([ex]), claude, { confirm: async () => true })
    expect(generateExplanations).toHaveBeenCalledOnce()
  })

  it('passes the Codex page limit, and the default one for Claude', async () => {
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(optionsOf(0).limits.maxPages).toBe(20)
    await startGeneration(session([null]), claude, { confirm: async () => true })
    expect(optionsOf(1).limits.maxPages).not.toBe(20)
  })

  it('does not start a second run while one is active', async () => {
    generationRuns.update('s1', { status: 'running' })
    await startGeneration(session([null]), claude, { confirm: async () => true })
    expect(generateExplanations).not.toHaveBeenCalled()
  })
})

describe('retryGeneration', () => {
  it('continues with the pages the stopped run is missing', async () => {
    generationRuns.update('s1', { status: 'stopped', retry: [3, 4] })
    await retryGeneration(session([null]), codex)
    expect(optionsOf(0).pages).toEqual([3, 4])
  })

  it('does nothing without pages to retry', async () => {
    generationRuns.update('s1', { status: 'stopped', retry: [] })
    await retryGeneration(session([null]), codex)
    expect(generateExplanations).not.toHaveBeenCalled()
  })
})
