import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupModels, modelLookupFailed, resetAiCache } from '../../src/ai/cliCache'

const cliModels = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []))
vi.mock('../../src/ai/cliIpc', () => ({ cliModels, cliInfo: vi.fn() }))

afterEach(() => {
  resetAiCache()
  cliModels.mockReset().mockResolvedValue([])
})

describe('model lookup failures', () => {
  it('are remembered for the app session', async () => {
    cliModels.mockRejectedValueOnce(new Error('no cli'))
    await expect(lookupModels('codex', '')).rejects.toThrow()
    expect(modelLookupFailed('codex', '')).toBe(true)
    expect(modelLookupFailed('codex', 'other.exe')).toBe(false)
  })

  it('are forgotten once a lookup succeeds (Settings asks again)', async () => {
    cliModels.mockRejectedValueOnce(new Error('no cli'))
    await expect(lookupModels('codex', '')).rejects.toThrow()
    await lookupModels('codex', '')
    expect(cliModels).toHaveBeenCalledTimes(2)
    expect(modelLookupFailed('codex', '')).toBe(false)
  })

  it('are cleared by resetAiCache', async () => {
    cliModels.mockRejectedValueOnce(new Error('no cli'))
    await expect(lookupModels('codex', '')).rejects.toThrow()
    resetAiCache()
    expect(modelLookupFailed('codex', '')).toBe(false)
  })
})
