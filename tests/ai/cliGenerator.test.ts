import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIMITS } from '../../src/ai/chunking'
import { cliConfigOf } from '../../src/ai/config'
import { CODEX_LIMITS, cliGenerator, limitsFor } from '../../src/ai/cliGenerator'
import type { CliConfig } from '../../src/ai/cliIpc'
import { describeError } from '../../src/ai/generate'
import { defaultPreferences } from '../../src/core/settings/preferences'

const claude: CliConfig = { cli: 'claude', path: 'C:\\claude.exe', model: 'opus', effort: 'medium' }
const codex: CliConfig = { cli: 'codex', path: 'C:\\codex.exe', model: '', effort: 'low' }
const req = { system: 's', user: 'u' }

afterEach(() => vi.useRealTimers())

describe('cliConfigOf / limitsFor', () => {
  it('picks the Claude or Codex fields by aiCli', () => {
    const p = { ...defaultPreferences(), aiClaudeModel: 'sonnet', aiClaudeEffort: 'high', aiClaudePath: 'a', aiCodexModel: 'gpt', aiCodexEffort: 'low', aiCodexPath: 'b' }
    expect(cliConfigOf({ ...p, aiCli: 'claude' })).toEqual({ cli: 'claude', path: 'a', model: 'sonnet', effort: 'high' })
    expect(cliConfigOf({ ...p, aiCli: 'codex' })).toEqual({ cli: 'codex', path: 'b', model: 'gpt', effort: 'low' })
  })

  it('Codex gets 20 pages per request, Claude the defaults', () => {
    expect(limitsFor('codex').maxPages).toBe(20)
    expect(CODEX_LIMITS).toEqual({ ...DEFAULT_LIMITS, maxPages: 20 })
    expect(limitsFor('claude')).toBe(DEFAULT_LIMITS)
  })
})

describe('cliGenerator', () => {
  it('names the model after the CLI', () => {
    expect(cliGenerator(claude).model).toBe('claude-code:opus')
    expect(cliGenerator(codex).model).toBe('codex:default')
  })

  it('forwards lines and returns the outcome', async () => {
    const generate = vi.fn(async (_id: number, _c: CliConfig, _s: string, _u: string, onLine: (l: string) => void) => {
      onLine('a')
      onLine('b')
      return 'truncated' as const
    })
    const lines: string[] = []
    const out = await cliGenerator(claude, { generate, cancel: vi.fn() }).generate(req, (l) => lines.push(l), new AbortController().signal)
    expect(out).toBe('truncated')
    expect(lines).toEqual(['a', 'b'])
    expect(generate.mock.calls[0].slice(1, 4)).toEqual([claude, 's', 'u'])
  })

  it('an already aborted signal resolves cancelled without generating', async () => {
    const generate = vi.fn()
    const ac = new AbortController()
    ac.abort()
    expect(await cliGenerator(claude, { generate, cancel: vi.fn() }).generate(req, () => {}, ac.signal)).toBe('cancelled')
    expect(generate).not.toHaveBeenCalled()
  })

  it('abort during generate cancels the same id once', async () => {
    let id = -1
    let finish: (v: 'cancelled') => void = () => {}
    const generate = vi.fn((rid: number) => {
      id = rid
      return new Promise<'cancelled'>((r) => (finish = r))
    })
    const cancel = vi.fn(async () => {})
    const ac = new AbortController()
    const p = cliGenerator(claude, { generate: generate as never, cancel }).generate(req, () => {}, ac.signal)
    ac.abort()
    finish('cancelled')
    expect(await p).toBe('cancelled')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(id)
  })

  it('a rejected AiCli error rejects with that object', async () => {
    const err = { code: 'AiCli', message: 'Run claude auth login' }
    const generate = vi.fn().mockRejectedValue(err)
    const p = cliGenerator(claude, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)
    await expect(p).rejects.toBe(err)
    expect(describeError(err)).toBe('Run claude auth login')
  })

  const overloaded = { code: 'AiCli', message: 'Codex: server overloaded' }

  it('Codex retries once after 5 s when overloaded before any line, with a new id', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValueOnce(overloaded).mockResolvedValueOnce('done')
    const p = cliGenerator(codex, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(4900)
    expect(generate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(await p).toBe('done')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1][0]).not.toBe(generate.mock.calls[0][0])
  })

  it('Codex retries only once', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValue(overloaded)
    const p = cliGenerator(codex, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)
    const assertion = expect(p).rejects.toBe(overloaded)
    await vi.advanceTimersByTimeAsync(6000)
    await assertion
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('aborting during the retry wait resolves cancelled without a second request', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValue(overloaded)
    const ac = new AbortController()
    const p = cliGenerator(codex, { generate, cancel: vi.fn() }).generate(req, () => {}, ac.signal)
    await vi.advanceTimersByTimeAsync(1000)
    ac.abort()
    expect(await p).toBe('cancelled')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('Claude is not retried', async () => {
    const generate = vi.fn().mockRejectedValue(overloaded)
    await expect(cliGenerator(claude, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)).rejects.toBe(overloaded)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('Codex is not retried after a line was delivered', async () => {
    const generate = vi.fn(async (_id: number, _c: CliConfig, _s: string, _u: string, onLine: (l: string) => void) => {
      onLine('x')
      throw overloaded
    })
    await expect(cliGenerator(codex, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)).rejects.toBe(overloaded)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('Codex does not retry other errors', async () => {
    const err = { code: 'AiCli', message: 'Run codex login' }
    const generate = vi.fn().mockRejectedValue(err)
    await expect(cliGenerator(codex, { generate, cancel: vi.fn() }).generate(req, () => {}, new AbortController().signal)).rejects.toBe(err)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
