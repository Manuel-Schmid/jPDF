import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../src/core/registry/commands'
import { KeybindingRegistry } from '../../src/core/registry/keybindings'
import {
  nextInstanceOfType,
  previousInstanceOfType,
  registerToolShortcuts,
} from '../../src/toolbar/toolShortcuts'
import { fakeSetup } from './fakeTools'

const tb = [
  { instanceId: 'p1', type: 'pen', settings: {} },
  { instanceId: 'h1', type: 'hand', settings: {} },
  { instanceId: 'p2', type: 'pen', settings: {} },
]

describe('nextInstanceOfType', () => {
  it('picks the first instance when another type is active', () => {
    expect(nextInstanceOfType(tb, 'h1', 'pen')).toBe('p1')
    expect(nextInstanceOfType(tb, null, 'pen')).toBe('p1')
  })

  it('cycles through instances of the active type', () => {
    expect(nextInstanceOfType(tb, 'p1', 'pen')).toBe('p2')
    expect(nextInstanceOfType(tb, 'p2', 'pen')).toBe('p1')
    expect(nextInstanceOfType(tb, 'h1', 'hand')).toBe('h1')
  })

  it('returns null when the type has no instance', () => {
    expect(nextInstanceOfType(tb, 'p1', 'text')).toBeNull()
  })
})

describe('previousInstanceOfType', () => {
  it('picks the last instance when another type is active', () => {
    expect(previousInstanceOfType(tb, 'h1', 'pen')).toBe('p2')
    expect(previousInstanceOfType(tb, null, 'pen')).toBe('p2')
  })

  it('cycles backwards through instances of the active type', () => {
    expect(previousInstanceOfType(tb, 'p2', 'pen')).toBe('p1')
    expect(previousInstanceOfType(tb, 'p1', 'pen')).toBe('p2')
    expect(previousInstanceOfType(tb, 'h1', 'hand')).toBe('h1')
  })

  it('returns null when the type has no instance', () => {
    expect(previousInstanceOfType(tb, 'p1', 'text')).toBeNull()
  })
})

describe('registerToolShortcuts', () => {
  const disposers: (() => void)[] = []
  afterEach(() => disposers.splice(0).forEach((d) => d()))

  const key = (k: string, shiftKey = false) => new KeyboardEvent('keydown', { key: k, shiftKey })

  it('binds the uppercase letter of each tool to tool.<type>', async () => {
    vi.useFakeTimers()
    const { registry, store } = fakeSetup([...tb])
    const cmds = new CommandRegistry()
    const keys = new KeybindingRegistry(cmds)
    disposers.push(registerToolShortcuts(registry, store, cmds, keys))
    expect(cmds.has('tool.pen')).toBe(true)
    expect(cmds.has('tool.hand')).toBe(true)

    expect(keys.handle(key('h'))).toBe(true)
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('h1')
    keys.handle(key('p'))
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('p1')
    keys.handle(key('p'))
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('p2')
    vi.useRealTimers()
  })

  it('binds Shift + the letter to the previous instance', async () => {
    vi.useFakeTimers()
    const { registry, store } = fakeSetup([...tb])
    const cmds = new CommandRegistry()
    const keys = new KeybindingRegistry(cmds)
    disposers.push(registerToolShortcuts(registry, store, cmds, keys))
    expect(cmds.has('tool.pen.previous')).toBe(true)

    store.setActive('h1')
    expect(keys.handle(key('P', true))).toBe(true)
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('p2')
    keys.handle(key('P', true))
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('p1')
    keys.handle(key('P', true))
    await Promise.resolve()
    expect(store.data.activeInstanceId).toBe('p2')
    vi.useRealTimers()
  })

  it('leaves Shift + the letter alone while typing in a field', () => {
    const { registry, store } = fakeSetup([...tb])
    const cmds = new CommandRegistry()
    const keys = new KeybindingRegistry(cmds)
    disposers.push(registerToolShortcuts(registry, store, cmds, keys))
    const input = document.createElement('input')
    document.body.append(input)
    const e = key('P', true)
    Object.defineProperty(e, 'target', { value: input })
    expect(keys.handle(e)).toBe(false)
    input.remove()
  })

  it('is disabled when the type has no instance; dispose unregisters', () => {
    const { registry, store } = fakeSetup([{ instanceId: 'h1', type: 'hand', settings: {} }])
    const cmds = new CommandRegistry()
    const keys = new KeybindingRegistry(cmds)
    const dispose = registerToolShortcuts(registry, store, cmds, keys)
    expect(keys.handle(key('p'))).toBe(false)
    expect(keys.handle(key('P', true))).toBe(false)
    dispose()
    expect(cmds.has('tool.hand')).toBe(false)
    expect(cmds.has('tool.hand.previous')).toBe(false)
    expect(keys.handle(key('h'))).toBe(false)
  })
})
