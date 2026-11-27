import { describe, expect, it, vi } from 'vitest'
import { registerAppCommands, type AppCommandActions } from '../../src/app/appCommands'
import { CommandRegistry } from '../../src/core/registry/commands'
import { KeybindingRegistry } from '../../src/core/registry/keybindings'

function setup(hasTab = true) {
  const cmds = new CommandRegistry()
  const keys = new KeybindingRegistry(cmds)
  const a: AppCommandActions = {
    open: vi.fn(),
    settings: vi.fn(),
    shortcuts: vi.fn(),
    closeTab: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    hasTab: () => hasTab,
    toggleThumbnails: vi.fn(),
  }
  const dispose = registerAppCommands(a, cmds, keys)
  const press = (init: KeyboardEventInit) => keys.handle(new KeyboardEvent('keydown', init))
  return { a, cmds, keys, dispose, press }
}

describe('registerAppCommands', () => {
  it('F1 opens the shortcuts', () => {
    const { a, press } = setup()
    expect(press({ key: 'F1' })).toBe(true)
    expect(a.shortcuts).toHaveBeenCalledOnce()
  })

  it('binds open, settings and the tab commands; tab commands need a tab', () => {
    const { a, cmds, press } = setup(false)
    press({ key: 'o', ctrlKey: true })
    press({ key: ',', ctrlKey: true })
    expect(a.open).toHaveBeenCalled()
    expect(a.settings).toHaveBeenCalled()
    expect(cmds.canExecute('tab.close')).toBe(false)
  })

  it('registers the thumbnails command without binding it (App binds it after the selection commands)', () => {
    const { cmds, keys } = setup()
    expect(cmds.has('view.thumbnails')).toBe(true)
    expect(keys.chordsOf('view.thumbnails')).toEqual([])
  })

  it('the disposer removes commands and keys', () => {
    const { cmds, keys, dispose } = setup()
    dispose()
    expect(cmds.has('app.shortcuts')).toBe(false)
    expect(keys.chordsOf('app.shortcuts')).toEqual([])
  })
})
