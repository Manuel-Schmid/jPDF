import { describe, expect, it, vi } from 'vitest'
import { rememberWindowState } from '../../src/app/windowState'

describe('rememberWindowState (window close)', () => {
  it('stores the state the backend reports', async () => {
    const store = { setWindowState: vi.fn() }
    const state = { maximized: false, x: 10, y: 20, width: 1280, height: 800 }
    await rememberWindowState(store, async () => state)
    expect(store.setWindowState).toHaveBeenCalledWith(state)
  })

  it('keeps the previous state when the backend has none', async () => {
    const store = { setWindowState: vi.fn() }
    await rememberWindowState(store, async () => null)
    expect(store.setWindowState).not.toHaveBeenCalled()
  })

  it('never blocks closing: a failing backend is logged and ignored', async () => {
    const store = { setWindowState: vi.fn() }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(rememberWindowState(store, async () => { throw new Error('boom') })).resolves.toBeUndefined()
    expect(store.setWindowState).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
