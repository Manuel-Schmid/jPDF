import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STARTUP_DELAY_MS, Updater, type AvailableUpdate, type UpdaterDeps } from '../../src/app/updates.svelte'

function release(version = '1.0.4'): AvailableUpdate & { download: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> } {
  return {
    version,
    notes: 'Faster saving',
    download: vi.fn(async (progress: (f: number | null) => void) => {
      progress(0.5)
      progress(1)
    }),
    install: vi.fn(async () => {}),
  }
}

function setup(over: Partial<UpdaterDeps> = {}) {
  const deps = {
    check: vi.fn(async (): Promise<AvailableUpdate | null> => null),
    ask: vi.fn(async () => 'update' as const),
    progress: vi.fn(),
    quit: vi.fn(async () => true),
    notify: vi.fn(),
    ...over,
  }
  return { deps, updater: new Updater(deps as UpdaterDeps) }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Updater: automatic check', () => {
  it('checks once, a few seconds after startup, when enabled', async () => {
    vi.useFakeTimers()
    const { deps, updater } = setup()
    updater.scheduleStartupCheck(() => true)
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS - 1)
    expect(deps.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.check).toHaveBeenCalledOnce()
  })

  it('does not check when turned off at that moment, or when cancelled', async () => {
    vi.useFakeTimers()
    const { deps, updater } = setup()
    updater.scheduleStartupCheck(() => false)
    updater.scheduleStartupCheck(() => true)()
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS)
    expect(deps.check).not.toHaveBeenCalled()
  })

  it('stays silent when up to date or offline', async () => {
    vi.useFakeTimers()
    const offline = setup({ check: vi.fn(async () => Promise.reject(new Error('offline'))) })
    const latest = setup()
    offline.updater.scheduleStartupCheck(() => true)
    latest.updater.scheduleStartupCheck(() => true)
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS)
    expect(offline.deps.notify).not.toHaveBeenCalled()
    expect(latest.deps.notify).not.toHaveBeenCalled()
    expect(offline.updater.checking).toBe(false)
  })
})

describe('Updater: Check now', () => {
  it('says when JuliePDF is up to date', async () => {
    const { deps, updater } = setup()
    await updater.checkNow()
    expect(deps.notify).toHaveBeenCalledWith('JuliePDF is up to date', 'info')
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('says when the check failed', async () => {
    const { deps, updater } = setup({ check: vi.fn(async () => Promise.reject(new Error('offline'))) })
    await updater.checkNow()
    expect(deps.notify).toHaveBeenCalledWith('Could not check for updates. Are you online?', 'error')
  })

  it('is "checking" while the check runs and ignores a second click meanwhile', async () => {
    let finish!: (u: AvailableUpdate | null) => void
    const { deps, updater } = setup({ check: vi.fn(() => new Promise<AvailableUpdate | null>((r) => (finish = r))) })
    const first = updater.checkNow()
    expect(updater.checking).toBe(true)
    await updater.checkNow()
    expect(deps.check).toHaveBeenCalledOnce()
    finish(null)
    await first
    expect(updater.checking).toBe(false)
  })
})

describe('Updater: installing', () => {
  it('offers the update; Update now downloads with progress, closes the tabs, then installs', async () => {
    const u = release()
    const order: string[] = []
    const { deps, updater } = setup({
      check: vi.fn(async () => u),
      quit: vi.fn(async () => (order.push('quit'), true)),
    })
    u.install.mockImplementation(async () => void order.push('install'))
    u.download.mockImplementation(async (progress: (f: number | null) => void) => {
      order.push('download')
      progress(0.5)
    })
    await updater.checkNow()
    expect(deps.ask).toHaveBeenCalledWith('1.0.4', 'Faster saving')
    expect(order).toEqual(['download', 'quit', 'install'])
    expect(deps.progress.mock.calls).toEqual([[null], [0.5], [undefined]])
  })

  it('Later downloads nothing', async () => {
    const u = release()
    const { deps, updater } = setup({ check: vi.fn(async () => u), ask: vi.fn(async () => 'later' as const) })
    await updater.checkNow()
    expect(u.download).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('a failed download (bad signature, offline) says so, hides the progress and installs nothing', async () => {
    const u = release()
    u.download.mockRejectedValue(new Error('signature mismatch'))
    const { deps, updater } = setup({ check: vi.fn(async () => u) })
    await updater.checkNow()
    expect(deps.notify).toHaveBeenCalledWith('Could not download the update', 'error')
    expect(deps.progress).toHaveBeenLastCalledWith(undefined)
    expect(deps.quit).not.toHaveBeenCalled()
    expect(u.install).not.toHaveBeenCalled()
  })

  it('Cancel at a save prompt keeps the tabs; the toast installs later', async () => {
    const u = release()
    const quit = vi.fn(async () => false)
    const { deps, updater } = setup({ check: vi.fn(async () => u), quit })
    await updater.checkNow()
    expect(u.install).not.toHaveBeenCalled()
    const [message, kind, action] = deps.notify.mock.calls[0]
    expect([message, kind]).toEqual(['JuliePDF 1.0.4 is ready to install', 'info'])
    quit.mockResolvedValue(true)
    action.run()
    await vi.waitFor(() => expect(u.install).toHaveBeenCalledOnce())
    expect(u.download).toHaveBeenCalledOnce()
  })

  it('a failed install says so', async () => {
    const u = release()
    u.install.mockRejectedValue(new Error('installer failed'))
    const { deps, updater } = setup({ check: vi.fn(async () => u) })
    await updater.checkNow()
    expect(deps.notify).toHaveBeenCalledWith('Could not install the update', 'error')
  })

  it('no second check while an update is being offered', async () => {
    let answer!: (c: 'update' | 'later') => void
    const { deps, updater } = setup({
      // Offered once; the check after Later finds nothing (no second prompt to answer).
      check: vi.fn<() => Promise<AvailableUpdate | null>>().mockResolvedValueOnce(release()).mockResolvedValue(null),
      ask: vi.fn(() => new Promise<'update' | 'later'>((r) => (answer = r))),
    })
    const first = updater.checkNow()
    await vi.waitFor(() => expect(deps.ask).toHaveBeenCalled())
    await updater.checkNow()
    expect(deps.check).toHaveBeenCalledOnce()
    answer('later')
    await first
    await updater.checkNow()
    expect(deps.check).toHaveBeenCalledTimes(2)
  })
})
