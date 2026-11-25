// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import { registerViewCommands, ZOOM_STEP } from '../../../src/core/viewer/viewCommands'

function setup(active: Partial<DocumentSession> | null) {
  const cmds = new CommandRegistry()
  const kb = new KeybindingRegistry(cmds)
  const dispose = registerViewCommands(() => active as DocumentSession | null, cmds, kb)
  return { cmds, kb, dispose }
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { ctrlKey: true, ...init })
}

describe('view commands', () => {
  it('zoom in/out multiply and divide the scale by 1.25', async () => {
    const s = { scale: 2, zoomTo: vi.fn(), fitWidth: vi.fn() }
    const { cmds } = setup(s)
    expect(ZOOM_STEP).toBe(1.25)
    await cmds.execute('view.zoomIn')
    expect(s.zoomTo).toHaveBeenLastCalledWith(2.5)
    await cmds.execute('view.zoomOut')
    expect(s.zoomTo).toHaveBeenLastCalledWith(1.6)
    await cmds.execute('view.fitWidth')
    expect(s.fitWidth).toHaveBeenCalledOnce()
  })

  it('binds Ctrl+=, Ctrl+Plus, Ctrl+Shift+Plus, Ctrl+- and Ctrl+0', () => {
    const s = { scale: 1, zoomTo: vi.fn(), fitWidth: vi.fn() }
    const { kb } = setup(s)
    expect(kb.handle(key({ key: '=' }))).toBe(true)
    expect(kb.handle(key({ key: '+' }))).toBe(true)
    expect(kb.handle(key({ key: '+', shiftKey: true }))).toBe(true)
    expect(s.zoomTo).toHaveBeenCalledTimes(3)
    expect(kb.handle(key({ key: '-' }))).toBe(true)
    expect(s.zoomTo).toHaveBeenCalledTimes(4)
    expect(kb.handle(key({ key: '0' }))).toBe(true)
    expect(s.fitWidth).toHaveBeenCalledOnce()
  })

  it('are disabled without an active document', () => {
    const { cmds, kb } = setup(null)
    expect(cmds.canExecute('view.zoomIn')).toBe(false)
    expect(kb.handle(key({ key: '0' }))).toBe(false)
  })

  it('dispose unregisters commands and bindings', () => {
    const { cmds, dispose } = setup(null)
    dispose()
    expect(cmds.has('view.zoomIn')).toBe(false)
    expect(cmds.has('view.fitWidth')).toBe(false)
  })

  it('Right / Left flip to the next / previous page without a selection', () => {
    const s = { flipPage: vi.fn(), toolState: { selection: [] as string[], textEdit: null as unknown } }
    const { kb } = setup(s as unknown as Partial<DocumentSession>)
    expect(kb.handle(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(true)
    expect(s.flipPage).toHaveBeenLastCalledWith(1)
    expect(kb.handle(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBe(true)
    expect(s.flipPage).toHaveBeenLastCalledWith(-1)
  })

  it('page flips are off with a selection or while a text box is edited (the arrows nudge or move the caret)', () => {
    const s = { flipPage: vi.fn(), toolState: { selection: ['a'] as string[], textEdit: null as unknown } }
    const { cmds } = setup(s as unknown as Partial<DocumentSession>)
    expect(cmds.canExecute('view.nextPage')).toBe(false)
    s.toolState.selection = []
    s.toolState.textEdit = {}
    expect(cmds.canExecute('view.previousPage')).toBe(false)
    s.toolState.textEdit = null
    expect(cmds.canExecute('view.previousPage')).toBe(true)
  })
})
