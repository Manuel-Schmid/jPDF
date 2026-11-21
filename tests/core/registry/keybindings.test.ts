// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { toasts } from '../../../src/ui/toasts.svelte'
import { KeybindingRegistry, chordFromEvent } from '../../../src/core/registry/keybindings'

function ev(init: KeyboardEventInit, target?: EventTarget): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (target) Object.defineProperty(e, 'target', { value: target })
  return e
}

describe('chordFromEvent', () => {
  it('normalises modifiers and letters', () => {
    expect(chordFromEvent(ev({ ctrlKey: true, shiftKey: true, key: 's' }))).toBe('Ctrl+Shift+S')
    expect(chordFromEvent(ev({ shiftKey: true, altKey: true, ctrlKey: true, key: 'a' }))).toBe('Ctrl+Alt+Shift+A')
  })
  it('keeps named keys as-is', () => {
    expect(chordFromEvent(ev({ key: 'F11' }))).toBe('F11')
    expect(chordFromEvent(ev({ key: 'Delete' }))).toBe('Delete')
    expect(chordFromEvent(ev({ key: 'Escape' }))).toBe('Escape')
  })
  it('maps space, plus and equals', () => {
    expect(chordFromEvent(ev({ key: ' ' }))).toBe('Space')
    expect(chordFromEvent(ev({ ctrlKey: true, key: '+' }))).toBe('Ctrl+Plus')
    expect(chordFromEvent(ev({ ctrlKey: true, key: '=' }))).toBe('Ctrl+=')
  })
})

describe('KeybindingRegistry', () => {
  function setup() {
    const cmds = new CommandRegistry()
    const run = vi.fn()
    cmds.register({ id: 'x', title: 'X', run })
    return { kb: new KeybindingRegistry(cmds), run }
  }

  it('handle executes bound command and returns true', () => {
    const { kb, run } = setup()
    kb.bind('Ctrl+Shift+S', 'x')
    expect(kb.handle(ev({ ctrlKey: true, shiftKey: true, key: 'S' }))).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('handle returns false for unbound chords', () => {
    const { kb, run } = setup()
    expect(kb.handle(ev({ key: 'F11' }))).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('bind disposer removes the binding', () => {
    const { kb } = setup()
    const dispose = kb.bind('F11', 'x')
    dispose()
    expect(kb.handle(ev({ key: 'F11' }))).toBe(false)
  })

  it('handle returns false when the bound command is unknown or disabled', () => {
    const cmds = new CommandRegistry()
    cmds.register({ id: 'off', title: 'Off', run: vi.fn(), enabled: () => false })
    const kb = new KeybindingRegistry(cmds)
    kb.bind('F11', 'off')
    kb.bind('F12', 'missing')
    expect(kb.handle(ev({ key: 'F11' }))).toBe(false)
    expect(kb.handle(ev({ key: 'F12' }))).toBe(false)
  })

  it('handle ignores unmodified chords when target is input/textarea/select/contenteditable', () => {
    const { kb, run } = setup()
    kb.bind('V', 'x')
    kb.bind('Delete', 'x')
    kb.bind('Space', 'x')
    kb.bind('Shift+A', 'x')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const t of [input, textarea, select, editable]) {
      expect(kb.handle(ev({ key: 'v' }, t))).toBe(false)
      expect(kb.handle(ev({ key: 'Delete' }, t))).toBe(false)
      expect(kb.handle(ev({ key: ' ' }, t))).toBe(false)
      expect(kb.handle(ev({ key: 'A', shiftKey: true }, t))).toBe(false)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('handle still fires modified chords, F-keys and Escape in inputs', () => {
    const { kb, run } = setup()
    kb.bind('Ctrl+S', 'x')
    kb.bind('F11', 'x')
    kb.bind('Escape', 'x')
    const input = document.createElement('input')
    expect(kb.handle(ev({ ctrlKey: true, key: 's' }, input))).toBe(true)
    expect(kb.handle(ev({ key: 'F11' }, input))).toBe(true)
    expect(kb.handle(ev({ key: 'Escape' }, input))).toBe(true)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('leaves copy, cut and paste in inputs to the field', () => {
    const { kb, run } = setup()
    for (const c of ['Ctrl+C', 'Ctrl+X', 'Ctrl+V']) kb.bind(c, 'x')
    const input = document.createElement('input')
    for (const key of ['c', 'x', 'v']) expect(kb.handle(ev({ ctrlKey: true, key }, input))).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(kb.handle(ev({ ctrlKey: true, key: 'v' }, document.body))).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('fires unmodified chords outside inputs', () => {
    const { kb, run } = setup()
    kb.bind('V', 'x')
    expect(kb.handle(ev({ key: 'v' }, document.body))).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('several commands may share a chord: the first enabled one runs', () => {
    const cmds = new CommandRegistry()
    const first = vi.fn()
    const second = vi.fn()
    let firstOn = false
    cmds.register({ id: 'first', title: 'First', run: first, enabled: () => firstOn })
    cmds.register({ id: 'second', title: 'Second', run: second })
    const kb = new KeybindingRegistry(cmds)
    const d1 = kb.bind('Escape', 'first')
    kb.bind('Escape', 'second')
    expect(kb.handle(ev({ key: 'Escape' }))).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    firstOn = true
    expect(kb.handle(ev({ key: 'Escape' }))).toBe(true)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    // Disposing one binding leaves the other.
    d1()
    expect(kb.handle(ev({ key: 'Escape' }))).toBe(true)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('a rejected or throwing command is reported, not left unhandled', async () => {
    const cmds = new CommandRegistry()
    cmds.register({ id: 'bad', title: 'Bad', run: async () => { throw new Error('boom') } })
    cmds.register({ id: 'worse', title: 'Worse', run: () => { throw new Error('sync boom') } })
    const onError = vi.fn()
    const kb = new KeybindingRegistry(cmds, onError)
    kb.bind('F1', 'bad')
    kb.bind('F2', 'worse')
    expect(kb.handle(ev({ key: 'F1' }))).toBe(true)
    expect(kb.handle(ev({ key: 'F2' }))).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls.map((c) => c[0]).sort()).toEqual(['bad', 'worse'])
  })

  it('the default error handler logs and shows an error toast', async () => {
    const cmds = new CommandRegistry()
    cmds.register({ id: 'bad', title: 'Bad', run: async () => { throw new Error('boom') } })
    const kb = new KeybindingRegistry(cmds)
    kb.bind('F1', 'bad')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    kb.handle(ev({ key: 'F1' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(err).toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('Something went wrong', 'error')
    err.mockRestore()
    show.mockRestore()
  })

  it('bare keys inside a popup (flyout, dialog, menu) do not fire; Ctrl chords, F-keys and Escape do', () => {
    const { kb, run } = setup()
    kb.bind('Delete', 'x')
    kb.bind('Backspace', 'x')
    kb.bind('Ctrl+S', 'x')
    kb.bind('Escape', 'x')
    for (const role of ['dialog', 'menu']) {
      const popup = document.createElement('div')
      popup.setAttribute('role', role)
      const swatch = document.createElement('button')
      popup.append(swatch)
      document.body.append(popup)
      expect(kb.handle(ev({ key: 'Delete' }, swatch))).toBe(false)
      expect(kb.handle(ev({ key: 'Backspace' }, swatch))).toBe(false)
      expect(run).not.toHaveBeenCalled()
      expect(kb.handle(ev({ ctrlKey: true, key: 's' }, swatch))).toBe(true)
      expect(kb.handle(ev({ key: 'Escape' }, swatch))).toBe(true)
      run.mockClear()
      popup.remove()
    }
    expect(kb.handle(ev({ key: 'Delete' }, document.body))).toBe(true)
  })
})
