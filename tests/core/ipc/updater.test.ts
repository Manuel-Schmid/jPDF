import { beforeEach, describe, expect, it, vi } from 'vitest'

const check = vi.fn()
vi.mock('@tauri-apps/plugin-updater', () => ({ check: (...args: unknown[]) => check(...args) }))

import { checkRelease, downloadProgress } from '../../../src/core/ipc/updater'

beforeEach(() => check.mockReset())

describe('downloadProgress', () => {
  it('reports the received fraction of the announced size', () => {
    const report = vi.fn()
    const on = downloadProgress(report)
    on({ event: 'Started', data: { contentLength: 200 } })
    on({ event: 'Progress', data: { chunkLength: 50 } })
    on({ event: 'Progress', data: { chunkLength: 150 } })
    on({ event: 'Finished' })
    expect(report.mock.calls.map((c) => c[0])).toEqual([0, 0.25, 1, 1])
  })

  it('reports null while the size is unknown', () => {
    const report = vi.fn()
    const on = downloadProgress(report)
    on({ event: 'Started', data: {} })
    on({ event: 'Progress', data: { chunkLength: 50 } })
    on({ event: 'Finished' })
    expect(report.mock.calls.map((c) => c[0])).toEqual([null, null, 1])
  })
})

describe('checkRelease', () => {
  it('is null when there is no newer release', async () => {
    check.mockResolvedValue(null)
    expect(await checkRelease()).toBeNull()
  })

  it('maps the plugin update: version, trimmed notes (none when blank), download and install', async () => {
    const download = vi.fn(async (on: (e: unknown) => void) => {
      on({ event: 'Started', data: { contentLength: 10 } })
      on({ event: 'Finished' })
    })
    const install = vi.fn(async () => {})
    check.mockResolvedValue({ version: '1.0.4', body: '  Faster saving\n', download, install })
    const u = (await checkRelease())!
    expect(u.version).toBe('1.0.4')
    expect(u.notes).toBe('Faster saving')
    const progress = vi.fn()
    await u.download(progress)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([0, 1])
    await u.install()
    expect(install).toHaveBeenCalledOnce()

    check.mockResolvedValue({ version: '1.0.5', body: '   ', download, install })
    expect((await checkRelease())!.notes).toBeUndefined()
  })
})
