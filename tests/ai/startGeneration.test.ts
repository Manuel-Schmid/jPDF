import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliConfig } from '../../src/ai/cliIpc'
import { generationRuns } from '../../src/ai/runs.svelte'
import { retryGeneration, startGeneration } from '../../src/ai/startGeneration'
import type { DocumentSession } from '../../src/core/session/session.svelte'

const generateExplanations = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
vi.mock('../../src/ai/generate', () => ({ generateExplanations }))
const cliGenerator = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ tag: 'generator' })))
vi.mock('../../src/ai/cliGenerator', async (orig) => ({
  ...(await orig<typeof import('../../src/ai/cliGenerator')>()),
  cliGenerator,
}))
const known = vi.hoisted(() => vi.fn((..._args: unknown[]): boolean | undefined => undefined))
const lookup = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => []))
vi.mock('../../src/ai/cliCache', () => ({ knownPictureSupport: known, lookupModels: lookup }))

const codex: CliConfig = { cli: 'codex', path: '', model: '', effort: 'medium' }
const claude: CliConfig = { cli: 'claude', path: '', model: 'opus', effort: 'medium' }
const ex = { text: 'x', model: 'm', createdAt: 't' }
const session = (explanations: unknown[]) => ({ id: 's1', explanations }) as unknown as DocumentSession
const optionsOf = (call: number) => generateExplanations.mock.calls[call]![2] as { limits: { maxPages: number }; pages?: number[] }

afterEach(() => {
  generateExplanations.mockClear()
  cliGenerator.mockClear()
  lookup.mockReset().mockResolvedValue([])
  known.mockReset().mockReturnValue(undefined)
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

  it('passes the pictures preference', async () => {
    await startGeneration(session([null]), claude, { confirm: async () => true }, 'all')
    expect((generateExplanations.mock.calls[0]![2] as { pictures: string }).pictures).toBe('all')
    await startGeneration(session([null]), claude, { confirm: async () => true })
    expect((generateExplanations.mock.calls[1]![2] as { pictures: string }).pictures).toBe('useful')
  })

  it('tells the generator whether the model reads pictures: the known answer, else yes', async () => {
    known.mockReturnValueOnce(false)
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(known).toHaveBeenCalledWith('codex', '', '')
    expect(cliGenerator.mock.calls[0]![2]).toEqual({ pictures: false })
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(cliGenerator.mock.calls[1]![2]).toEqual({ pictures: true })
  })

  it('Codex without a cached model list loads it first, and a text-only model gets no pictures', async () => {
    known.mockReturnValueOnce(undefined).mockReturnValueOnce(false)
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(lookup).toHaveBeenCalledWith('codex', '')
    expect(cliGenerator.mock.calls[0]![2]).toEqual({ pictures: false })
  })

  it('a failed model lookup still runs, with pictures', async () => {
    lookup.mockRejectedValueOnce(new Error('no cli'))
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(cliGenerator.mock.calls[0]![2]).toEqual({ pictures: true })
  })

  it('Claude never looks the models up', async () => {
    await startGeneration(session([null]), claude, { confirm: async () => true })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('does not start a second run while one is active', async () => {
    generationRuns.update('s1', { status: 'running' })
    await startGeneration(session([null]), claude, { confirm: async () => true })
    expect(generateExplanations).not.toHaveBeenCalled()
  })
})

describe('retryGeneration', () => {
  it('keeps the pictures preference', async () => {
    generationRuns.update('s1', { status: 'stopped', retry: [3] })
    await retryGeneration(session([null]), codex, 'all')
    expect((generateExplanations.mock.calls[0]![2] as { pictures: string }).pictures).toBe('all')
  })

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
