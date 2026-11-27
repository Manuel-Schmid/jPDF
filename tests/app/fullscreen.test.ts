// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fullscreen, registerFullscreenCommands } from '../../src/app/fullscreen.svelte'
import { CommandRegistry } from '../../src/core/registry/commands'
import { KeybindingRegistry } from '../../src/core/registry/keybindings'
import { bindShortcut } from '../../src/core/registry/shortcuts'
import { dismissable } from '../../src/ui/dismissable'
import { toasts } from '../../src/ui/toasts.svelte'

function fakeWindow(initial = false) {
  const w = {
    state: initial,
    setFullscreen: vi.fn(async (on: boolean) => {
      w.state = on
    }),
    isFullscreen: vi.fn(async () => w.state),
  }
  return w
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Fullscreen', () => {
  it('toggle sets active and calls setFullscreen(true), then false', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 0)
    await fs.toggle()
    expect(fs.active).toBe(true)
    expect(win.setFullscreen).toHaveBeenLastCalledWith(true)
    await fs.toggle()
    expect(fs.active).toBe(false)
    expect(win.setFullscreen).toHaveBeenLastCalledWith(false)
  })

  it('exit when inactive does nothing', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 0)
    await fs.exit()
    expect(win.setFullscreen).not.toHaveBeenCalled()
    expect(fs.active).toBe(false)
  })

  it('exit leaves fullscreen', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 0)
    await fs.toggle()
    await fs.exit()
    expect(win.setFullscreen).toHaveBeenLastCalledWith(false)
    expect(fs.active).toBe(false)
  })

  it('restores when the viewer resizes, not on a timer', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 500)
    const restore = vi.fn()
    let resize!: () => void
    fs.anchor = () => ({ restore, resized: new Promise<void>((r) => (resize = r)) })
    const done = fs.toggle()
    await vi.advanceTimersByTimeAsync(300)
    expect(restore).not.toHaveBeenCalled()
    resize()
    await done
    expect(restore).toHaveBeenCalledOnce()
  })

  it('falls back to a timeout when no resize arrives', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 500)
    const restore = vi.fn()
    fs.anchor = () => ({ restore, resized: new Promise<void>(() => {}) })
    const done = fs.toggle()
    await vi.advanceTimersByTimeAsync(499)
    expect(restore).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    await done
    expect(restore).toHaveBeenCalledOnce()
  })

  it('sync is skipped while a toggle is pending', async () => {
    const win = fakeWindow()
    let release!: () => void
    win.setFullscreen.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const fs = new Fullscreen(() => win, 0)
    const t = fs.toggle()
    await fs.sync()
    expect(win.isFullscreen).not.toHaveBeenCalled()
    release()
    await t
    expect(fs.active).toBe(true)
  })

  it('a failing window call keeps the state and shows a toast', async () => {
    const win = fakeWindow()
    win.setFullscreen.mockRejectedValue(new Error('denied'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    const fs = new Fullscreen(() => win, 0)
    await fs.toggle()
    expect(fs.active).toBe(false)
    expect(show).toHaveBeenCalledWith('Could not change fullscreen mode', 'error')
    err.mockRestore()
    show.mockRestore()
  })

  it('follows the window when fullscreen is left by other means (resize)', async () => {
    const win = fakeWindow()
    const fs = new Fullscreen(() => win, 0)
    const stop = fs.start()
    await fs.toggle()
    win.state = false // left with the OS
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.active).toBe(false)
    stop()
    win.state = true
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.active).toBe(false)
  })
})

describe('fullscreen commands and Escape priority', () => {
  function setup() {
    const win = fakeWindow(true)
    const fs = new Fullscreen(() => win, 0)
    fs.active = true
    const cmds = new CommandRegistry()
    const keys = new KeybindingRegistry(cmds)
    // Selection commands register first, as in App.
    let selected = true
    const deselect = vi.fn(() => void (selected = false))
    cmds.register({ id: 'edit.deselect', title: 'Deselect', enabled: () => selected, run: deselect })
    bindShortcut(keys, 'edit.deselect')
    registerFullscreenCommands(fs, cmds, keys)
    const esc = () => keys.handle(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    return { win, fs, keys, esc, deselect }
  }

  it('F11 toggles fullscreen', async () => {
    const { fs, keys } = setup()
    expect(keys.handle(new KeyboardEvent('keydown', { key: 'F11' }))).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.active).toBe(false)
  })

  it('Escape deselects first, and only then exits fullscreen', async () => {
    const { fs, esc, deselect } = setup()
    expect(esc()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(deselect).toHaveBeenCalledOnce()
    expect(fs.active).toBe(true)
    expect(esc()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.active).toBe(false)
    // Not fullscreen any more and nothing selected: Escape passes through.
    expect(esc()).toBe(false)
  })

  it('Escape closes a flyout before exiting fullscreen', async () => {
    const { fs, keys } = setup()
    const flyout = document.createElement('div')
    document.body.append(flyout)
    const onclose = vi.fn()
    const action = dismissable(flyout, { onclose })
    // App listens in the bubble phase; the flyout in the capture phase and stops propagation.
    const onKeydown = (e: KeyboardEvent) => void keys.handle(e)
    window.addEventListener('keydown', onKeydown)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(onclose).toHaveBeenCalledOnce()
    expect(fs.active).toBe(true)

    action.destroy()
    // Flyout gone: the selection goes next, then fullscreen.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.active).toBe(false)
    window.removeEventListener('keydown', onKeydown)
    flyout.remove()
  })
})
