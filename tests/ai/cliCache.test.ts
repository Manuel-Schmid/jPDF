import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetCli, lookupInfo, lookupModels, modelLookupFailed, resetAiCache } from '../../src/ai/cliCache'

const cliModels = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []))
const cliInfo = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ found: true, path: 'c', version: '1', signedIn: true as boolean | null, desktop: false })))
vi.mock('../../src/ai/cliIpc', () => ({ cliModels, cliInfo }))

afterEach(() => {
  resetAiCache()
  cliModels.mockReset().mockResolvedValue([])
  cliInfo.mockClear()
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

describe('CLI info', () => {
  it('is kept once usable, asked again while not signed in, and Check again forgets it', async () => {
    await lookupInfo('claude', '')
    await lookupInfo('claude', '')
    expect(cliInfo).toHaveBeenCalledTimes(1)
    forgetCli('claude', '')
    await lookupInfo('claude', '')
    expect(cliInfo).toHaveBeenCalledTimes(2)

    cliInfo.mockResolvedValueOnce({ found: true, path: 'c', version: '1', signedIn: false, desktop: true })
    await lookupInfo('claude', 'x')
    await lookupInfo('claude', 'x')
    expect(cliInfo).toHaveBeenCalledTimes(4)
  })
})
