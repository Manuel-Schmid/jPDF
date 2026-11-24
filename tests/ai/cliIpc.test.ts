import { afterEach, describe, expect, it, vi } from 'vitest'

/** The fake backend: the last channel created, and what the command answers. */
const tauri = vi.hoisted(() => {
  class Channel<T> {
    onmessage: (m: T) => void = () => {}
    constructor() {
      tauri.channel = this as unknown as { onmessage: (m: string) => void }
    }
  }
  return {
    Channel,
    channel: null as { onmessage: (m: string) => void } | null,
    invoke: vi.fn(async (_cmd: string, _args: unknown): Promise<unknown> => undefined),
  }
})
vi.mock('@tauri-apps/api/core', () => ({ Channel: tauri.Channel, invoke: tauri.invoke }))

import { cliGenerate, LINE_WAIT_MS, type CliConfig } from '../../src/ai/cliIpc'

const config: CliConfig = { cli: 'claude', path: '', model: 'opus', effort: 'medium' }
const send = (line: string) => tauri.channel!.onmessage(line)

afterEach(() => {
  vi.useRealTimers()
  tauri.invoke.mockReset()
})

describe('cliGenerate', () => {
  it('resolves at once when every line already arrived', async () => {
    tauri.invoke.mockImplementation(async () => {
      send('a')
      send('b')
      return { outcome: 'done', lines: 2 }
    })
    const lines: string[] = []
    expect(await cliGenerate(1, config, 'S', 'U', (l) => lines.push(l))).toBe('done')
    expect(lines).toEqual(['a', 'b'])
    expect(tauri.invoke).toHaveBeenCalledWith('ai_cli_generate', expect.objectContaining({ requestId: 1, config, images: [] }))
  })

  it('waits for lines the answer overtook', async () => {
    tauri.invoke.mockImplementation(async () => {
      send('a')
      return { outcome: 'truncated', lines: 3 }
    })
    const lines: string[] = []
    let result: string | null = null
    const p = cliGenerate(2, config, 'S', 'U', (l) => lines.push(l)).then((o) => (result = o))
    await Promise.resolve()
    await Promise.resolve()
    expect(result).toBeNull()
    send('b')
    await Promise.resolve()
    expect(result).toBeNull()
    send('c')
    await p
    expect(result).toBe('truncated')
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('gives up waiting after a short time and drops stragglers', async () => {
    vi.useFakeTimers()
    tauri.invoke.mockResolvedValue({ outcome: 'done', lines: 2 })
    const lines: string[] = []
    let result: string | null = null
    const p = cliGenerate(3, config, 'S', 'U', (l) => lines.push(l)).then((o) => (result = o))
    await vi.advanceTimersByTimeAsync(LINE_WAIT_MS - 1)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(result).toBe('done')
    send('late')
    expect(lines).toEqual([])
  })

  it('passes a failure on', async () => {
    tauri.invoke.mockRejectedValue({ code: 'AiCli', message: 'Claude Code failed.' })
    await expect(cliGenerate(4, config, 'S', 'U', () => {})).rejects.toMatchObject({ message: 'Claude Code failed.' })
  })
})
