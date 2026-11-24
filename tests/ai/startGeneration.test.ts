import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliConfig } from '../../src/ai/cliIpc'
import { generationRuns } from '../../src/ai/runs.svelte'
import { retryGeneration, startGeneration } from '../../src/ai/startGeneration'
import type { DocumentSession } from '../../src/core/session/session.svelte'

// Like the real one, it ends the run it took over (here: as if finished).
const generateExplanations = vi.hoisted(() =>
  vi.fn(async (...args: unknown[]) => {
    const { generationRuns } = await import('../../src/ai/runs.svelte')
    generationRuns.clear((args[0] as { id: string }).id)
  }),
)
vi.mock('../../src/ai/generate', () => ({ generateExplanations }))
const cliGenerator = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ tag: 'generator' })))
vi.mock('../../src/ai/cliGenerator', async (orig) => ({
  ...(await orig<typeof import('../../src/ai/cliGenerator')>()),
  cliGenerator,
}))
const known = vi.hoisted(() => vi.fn((..._args: unknown[]): boolean | undefined => undefined))
const lookup = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => []))
const failed = vi.hoisted(() => vi.fn((..._args: unknown[]) => false))
vi.mock('../../src/ai/cliCache', () => ({ knownPictureSupport: known, lookupModels: lookup, modelLookupFailed: failed }))

const codex: CliConfig = { cli: 'codex', path: '', model: '', effort: 'medium' }
const claude: CliConfig = { cli: 'claude', path: '', model: 'opus', effort: 'medium' }
const ex = { text: 'x', model: 'm', createdAt: 't' }
const session = (explanations: unknown[]) => ({ id: 's1', explanations, pages: [{}, {}] }) as unknown as DocumentSession
const optionsOf = (call: number) => generateExplanations.mock.calls[call]![2] as { limits: { maxPages: number }; pages?: number[] }

afterEach(() => {
  generateExplanations.mockClear()
  cliGenerator.mockClear()
  lookup.mockReset().mockResolvedValue([])
  known.mockReset().mockReturnValue(undefined)
  failed.mockReset().mockReturnValue(false)
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

  it('shows the run as preparing, with Cancel, while Codex lists its models', async () => {
    let resolve!: (v: unknown) => void
    lookup.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const started = startGeneration(session([null]), codex, { confirm: async () => true })
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
    const run = generationRuns.get('s1')!
    expect(run.status).toBe('preparing')
    expect(run.total).toBe(2)
    expect(run.controller).toBeInstanceOf(AbortController)
    resolve([])
    await started
    // generateExplanations takes over the same run.
    expect((generateExplanations.mock.calls[0]![2] as { controller: unknown }).controller).toBe(run.controller)
  })

  it('Cancel during the model lookup stops without generating', async () => {
    lookup.mockReturnValueOnce(new Promise(() => {}))
    const started = startGeneration(session([null]), codex, { confirm: async () => true })
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
    generationRuns.cancel('s1')
    await started
    expect(generateExplanations).not.toHaveBeenCalled()
    expect(generationRuns.get('s1')).toMatchObject({ status: 'stopped', message: 'Cancelled.', controller: null })
  })

  it('a run forgotten during the lookup (tab closed) reports nothing', async () => {
    let resolve!: (v: unknown) => void
    lookup.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const started = startGeneration(session([null]), codex, { confirm: async () => true })
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
    generationRuns.cancel('s1')
    generationRuns.clear('s1')
    resolve([])
    await started
    expect(generateExplanations).not.toHaveBeenCalled()
    expect(generationRuns.get('s1')).toBeUndefined()
  })

  it('does not wait for a model lookup that already failed this session', async () => {
    failed.mockReturnValue(true)
    await startGeneration(session([null]), codex, { confirm: async () => true })
    expect(lookup).not.toHaveBeenCalled()
    expect(cliGenerator.mock.calls[0]![2]).toEqual({ pictures: true })
  })

  it('a failure before generating leaves a stopped run, not a spinning one', async () => {
    cliGenerator.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await expect(startGeneration(session([null]), claude, { confirm: async () => true })).rejects.toThrow('boom')
    expect(generationRuns.get('s1')?.status).toBe('stopped')
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
