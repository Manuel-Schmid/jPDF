import { describe, expect, it, vi } from 'vitest'
import { registerAppCommands } from '../../../src/app/appCommands'
import { registerFindCommands, type FindState } from '../../../src/app/find.svelte'
import { registerFullscreenCommands, type Fullscreen } from '../../../src/app/fullscreen.svelte'
import { registerSaveCommands } from '../../../src/app/saveFlow'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  bindShortcut,
  chordLabel,
  chordsFor,
  keyCaps,
  shortcutHint,
  shortcutSections,
  withShortcut,
  addChord,
  chordsIn,
  clashesWith,
  keyProblem,
  removeChord,
  resetShortcut,
  useShortcutOverrides,
} from '../../../src/core/registry/shortcuts'
import { afterEach } from 'vitest'
import { registerEditCommands } from '../../../src/core/session/editCommands'
import { registerAnnotationViewCommands } from '../../../src/core/viewer/annotationView.svelte'
import { registerViewCommands } from '../../../src/core/viewer/viewCommands'
import { registerClipboardCommands } from '../../../src/tools/select/clipboard'
import { registerSelectionCommands } from '../../../src/tools/select/commands'
import { registerNudgeCommands } from '../../../src/tools/select/nudge'

/** A registry that remembers every chord bound to it, in order. */
class RecordingKeys extends KeybindingRegistry {
  bound: [chord: string, id: string][] = []
  override bind(chord: string, id: string): () => void {
    this.bound.push([chord, id])
    return super.bind(chord, id)
  }
  override bindLive(id: string, chords: () => readonly string[]): () => void {
    for (const c of chords()) this.bound.push([c, id])
    return super.bindLive(id, chords)
  }
}

/** Registers every command module the way App does (without the tool letters), on fresh registries. */
function registerAll(): RecordingKeys {
  const cmds = new CommandRegistry()
  const keys = new RecordingKeys(cmds)
  const none = () => null
  const no = () => false
  registerAppCommands(
    {
      open: vi.fn(),
      settings: vi.fn(),
      shortcuts: vi.fn(),
      closeTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      hasTab: no,
      toggleThumbnails: vi.fn(),
    },
    cmds,
    keys,
  )
  registerViewCommands(none, cmds, keys)
  registerAnnotationViewCommands(no, undefined, cmds, keys)
  registerFindCommands({ show: vi.fn() } as unknown as FindState, no, cmds, keys)
  registerEditCommands(none, cmds, keys)
  registerSaveCommands(none, cmds, keys)
  registerSelectionCommands(none, cmds, keys)
  bindShortcut(keys, 'view.thumbnails')
  registerNudgeCommands(none, cmds, keys)
  registerClipboardCommands(
    none,
    { writeText: vi.fn(), readText: vi.fn(), readImage: vi.fn() } as never,
    undefined,
    cmds,
    keys,
  )
  registerFullscreenCommands(
    { toggle: vi.fn(), exit: vi.fn(), active: false } as unknown as Fullscreen,
    cmds,
    keys,
  )
  return keys
}

/** `Ctrl+Alt+Shift+Key`, modifiers in that order, each at most once. */
const CHORD = /^(Ctrl\+)?(Alt\+)?(Shift\+)?[^+]+$/

describe('shortcut catalog', () => {
  it('has unique ids, known groups and well-formed chords', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(SHORTCUT_GROUPS.map((g) => g.id))
    for (const s of SHORTCUTS) {
      expect(groups.has(s.group), s.id).toBe(true)
      expect(s.label.trim(), s.id).not.toBe('')
      expect(s.defaultChords.length, s.id).toBeGreaterThan(0)
      for (const c of [...s.defaultChords, ...(s.variants ?? [])]) expect(c, s.id).toMatch(CHORD)
    }
  })

  it('binds every bindable entry, and nothing it does not list', () => {
    const keys = registerAll()
    const bound = new Set(keys.bound.map(([, id]) => id))
    const bindable = SHORTCUTS.filter((s) => !s.fixed).map((s) => s.id)
    expect([...bound].sort()).toEqual([...bindable].sort())
  })

  it('binds exactly the catalog keys of each command, variants included', () => {
    const keys = registerAll()
    for (const s of SHORTCUTS.filter((e) => !e.fixed)) {
      const chords = keys.bound.filter(([, id]) => id === s.id).map(([c]) => c)
      expect(chords, s.id).toEqual([...s.defaultChords, ...(s.variants ?? [])])
    }
  })

  it('keeps shared keys in their order: bold before the thumbnails, page flips before nudges, deselect before leaving fullscreen', () => {
    const keys = registerAll()
    const order = (chord: string) => keys.bound.filter(([c]) => c === chord).map(([, id]) => id)
    expect(order('Ctrl+B')).toEqual(['text.bold', 'view.thumbnails'])
    expect(order('ArrowRight')).toEqual(['view.nextPage', 'edit.nudgeRight'])
    expect(order('Escape')).toEqual(['edit.deselect', 'view.exitFullscreen'])
  })
})

describe('bindShortcut', () => {
  it('binds shown keys and variants, and the disposer unbinds them', () => {
    const cmds = new CommandRegistry()
    const keys = new RecordingKeys(cmds)
    const dispose = bindShortcut(keys, 'view.zoomIn')
    expect(keys.chordsOf('view.zoomIn')).toEqual(['Ctrl+Plus', 'Ctrl+=', 'Ctrl+Shift+Plus'])
    dispose()
    expect(keys.chordsOf('view.zoomIn')).toEqual([])
  })

  it('throws for an unknown or fixed entry', () => {
    const keys = new KeybindingRegistry(new CommandRegistry())
    expect(() => bindShortcut(keys, 'no.such')).toThrow()
    expect(() => bindShortcut(keys, 'view.pan')).toThrow()
  })
})

describe('shortcut text', () => {
  it('names keys as caps and labels', () => {
    expect(keyCaps('Ctrl+Shift+ArrowLeft')).toEqual(['Ctrl', 'Shift', '←'])
    expect(keyCaps('Ctrl+Plus')).toEqual(['Ctrl', '+'])
    expect(chordLabel('Delete')).toBe('Del')
    expect(chordLabel('Ctrl+-')).toBe('Ctrl+-')
  })

  it('quotes a command for tooltips, without layout variants', () => {
    expect(chordsFor('view.zoomIn')).toEqual(['Ctrl+Plus'])
    expect(shortcutHint('view.thumbnails')).toBe('Ctrl+B / F4')
    expect(withShortcut('Find', 'view.find')).toBe('Find (Ctrl+F)')
    expect(withShortcut('Flatten', 'edit.flatten')).toBe('Flatten')
  })
})

describe('shortcutSections', () => {
  const tools = [
    { type: 'pen', displayName: 'Pen', shortcut: 'p' },
    { type: 'marker', displayName: 'Marker', shortcut: 'M' },
  ]

  it('lists the groups in order, each with its catalog rows', () => {
    const sections = shortcutSections(tools)
    expect(sections.map((s) => s.group)).toEqual(SHORTCUT_GROUPS.map((g) => g.id))
    const files = sections.find((s) => s.group === 'files')!
    expect(files.rows[0]).toMatchObject({
      id: 'file.open',
      label: 'Open a PDF',
      chords: ['Ctrl+O'],
    })
    // Layout variants are bound, never shown.
    const view = sections.find((s) => s.group === 'view')!
    expect(view.rows.find((r) => r.id === 'view.zoomIn')!.chords).toEqual(['Ctrl+Plus'])
  })

  it('puts the given tools first in Tools, with their upper-case letters', () => {
    const rows = shortcutSections(tools).find((s) => s.group === 'tools')!.rows
    expect(rows.slice(0, 2)).toEqual([
      { id: 'tool.pen', label: 'Pen', chords: ['P'], fixed: false },
      { id: 'tool.marker', label: 'Marker', chords: ['M'], fixed: false },
    ])
    expect(rows[2].id).toBe('tool.escapeToSelect')
  })

  it('marks fixed entries, which customizing will leave alone', () => {
    const pan = shortcutSections([])
      .flatMap((s) => s.rows)
      .find((r) => r.id === 'view.pan')!
    expect(pan.fixed).toBe(true)
  })
})

describe('customized shortcuts', () => {
  afterEach(() => useShortcutOverrides(() => ({})))

  it('an override replaces the keys (variants included) everywhere: binding, list and tooltips', () => {
    let overrides: Record<string, string[]> = {}
    useShortcutOverrides(() => overrides)
    const cmds = new CommandRegistry()
    const run = vi.fn()
    cmds.register({ id: 'view.zoomIn', title: 'Zoom in', run })
    const keys = new KeybindingRegistry(cmds)
    bindShortcut(keys, 'view.zoomIn')
    const press = (init: KeyboardEventInit) => keys.handle(new KeyboardEvent('keydown', init))

    overrides = { 'view.zoomIn': ['Ctrl+K'] }
    // Applied at once, without binding again.
    expect(press({ key: '=', ctrlKey: true })).toBe(false)
    expect(press({ key: 'k', ctrlKey: true })).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(chordsFor('view.zoomIn')).toEqual(['Ctrl+K'])
    expect(withShortcut('Zoom in', 'view.zoomIn')).toBe('Zoom in (Ctrl+K)')
    expect(keys.chordsOf('view.zoomIn')).toEqual(['Ctrl+K'])
  })

  it('an empty override means no shortcut; fixed entries ignore overrides', () => {
    useShortcutOverrides(() => ({ 'view.find': [], 'view.pan': ['P'] }))
    expect(chordsFor('view.find')).toEqual([])
    expect(withShortcut('Find', 'view.find')).toBe('Find')
    expect(chordsFor('view.pan')).toEqual(['Space'])
  })

  it('keeps the order of commands that share a key after a change', () => {
    let overrides: Record<string, string[]> = {}
    useShortcutOverrides(() => overrides)
    const cmds = new CommandRegistry()
    const first = vi.fn()
    const second = vi.fn()
    cmds.register({ id: 'text.bold', title: 'Bold', run: first })
    cmds.register({ id: 'view.thumbnails', title: 'Thumbnails', run: second })
    const keys = new KeybindingRegistry(cmds)
    bindShortcut(keys, 'text.bold')
    bindShortcut(keys, 'view.thumbnails')
    overrides = { 'text.bold': ['Ctrl+B', 'Ctrl+M'], 'view.thumbnails': ['Ctrl+M'] }
    keys.handle(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }))
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })
})

describe('editing rules', () => {
  const tools = new Map([
    ['P', 'Pen'],
    ['Shift+P', 'Pen'],
  ])

  it('refuses reserved keys, modifiers alone and tool letters, with a reason', () => {
    for (const c of [
      'Escape',
      'Enter',
      'Tab',
      'Shift+Tab',
      'Space',
      'Ctrl+Control',
      'Shift',
      'Alt+Alt',
    ]) {
      expect(keyProblem(c, tools), c).not.toBeNull()
    }
    expect(keyProblem('P', tools)).toMatch(/Pen tool/)
    expect(keyProblem('Shift+P', tools)).toMatch(/Pen tool/)
    expect(keyProblem('Ctrl+K', tools)).toBeNull()
    // Browser keys stay assignable: the guard only cancels the WebView's own action.
    expect(keyProblem('Ctrl+P', tools)).toBeNull()
  })

  it('names the commands a key would clash with, except those that share it on purpose', () => {
    expect(clashesWith({}, 'Ctrl+F', 'view.fitWidth').map((e) => e.id)).toEqual(['view.find'])
    expect(clashesWith({}, 'Ctrl+F', 'view.find')).toEqual([])
    // Bold and the thumbnails share Ctrl+B on purpose (bold only with a text box selected).
    expect(clashesWith({}, 'Ctrl+B', 'view.thumbnails')).toEqual([])
    // A key the user removed elsewhere no longer clashes.
    expect(clashesWith({ 'view.find': [] }, 'Ctrl+F', 'view.fitWidth')).toEqual([])
  })

  it('adds a key (taking it from replaced commands), removes one, resets one', () => {
    let o = addChord({}, 'view.fitWidth', 'Ctrl+F', ['view.find'])
    expect(chordsIn(o, 'view.fitWidth')).toEqual(['Ctrl+0', 'Ctrl+F'])
    expect(chordsIn(o, 'view.find')).toEqual([])
    o = removeChord(o, 'view.fitWidth', 'Ctrl+0')
    expect(chordsIn(o, 'view.fitWidth')).toEqual(['Ctrl+F'])
    o = resetShortcut(o, 'view.fitWidth')
    expect(o).toEqual({ 'view.find': [] })
    expect(chordsIn(o, 'view.fitWidth')).toEqual(['Ctrl+0'])
  })

  it('stores nothing for a command that is back at its defaults', () => {
    const o = removeChord(addChord({}, 'view.find', 'Ctrl+K', []), 'view.find', 'Ctrl+K')
    expect(o).toEqual({})
  })

  it('adding a key the command already has changes nothing', () => {
    expect(addChord({}, 'view.find', 'Ctrl+F', [])).toEqual({})
  })
})

describe('hidden entries (the arrow-key nudges)', () => {
  afterEach(() => useShortcutOverrides(() => ({})))

  it('are bound but not listed', () => {
    const rows = shortcutSections([]).flatMap((s) => s.rows)
    expect(rows.some((r) => r.id.startsWith('edit.nudge'))).toBe(false)
    expect(rows.some((r) => r.id === 'view.nextPage')).toBe(true)
  })

  it('keep their keys: overrides are ignored, and their keys cannot go elsewhere', () => {
    useShortcutOverrides(() => ({ 'edit.nudgeUp': ['Ctrl+K'] }))
    expect(chordsFor('edit.nudgeUp')).toEqual(['ArrowUp'])
    const none = new Map<string, string>()
    expect(keyProblem('ArrowUp', none)).toMatch(/moves? the selection/)
    expect(keyProblem('Shift+ArrowLeft', none)).toMatch(/moves? the selection/)
    // Page flips share the arrows on purpose: Next page can get its key back.
    expect(keyProblem('ArrowRight', none, 'view.nextPage')).toBeNull()
  })
})
