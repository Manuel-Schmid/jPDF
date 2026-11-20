import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import type { TextEdit } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { FreeTextAnnotation, HighlightAnnotation } from '../../../src/core/session/model'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { toasts } from '../../../src/ui/toasts.svelte'
import '../../../src/annotations'
import { DUPLICATE_OFFSET, duplicatesOf, editAnnotations, editSelected, registerSelectionCommands } from '../../../src/tools/select/commands'
import { boxHeight, layoutLines } from '../../../src/core/geometry/textLayout'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

const hl: HighlightAnnotation = {
  id: 'h', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
  quads: [[0, 10, 10, 10, 0, 0, 10, 0]], color: [1, 1, 0], opacity: 0.4,
}

function setup() {
  const store = new AnnotationStore()
  store.load([hl])
  const history = new History(store)
  const session = { store, history } as unknown as DocumentSession
  const state = { selection: [] as string[], textEdit: null as TextEdit | null }
  const cmds = new CommandRegistry()
  const keys = new KeybindingRegistry(cmds)
  let active = true
  const dispose = registerSelectionCommands(() => (active ? { session, state } : null), cmds, keys)
  return { store, history, state, cmds, keys, dispose, deactivate: () => (active = false) }
}

describe('selection commands', () => {
  it('edit.delete deletes the selection (Delete, Backspace) as one undo step', async () => {
    const t = setup()
    expect(t.cmds.canExecute('edit.delete')).toBe(false)
    expect(t.keys.handle(key({ key: 'Delete' }))).toBe(false)
    t.state.selection = ['h']
    expect(t.keys.handle(key({ key: 'Delete' }))).toBe(true)
    await Promise.resolve()
    expect(t.store.all()).toEqual([])
    expect(t.state.selection).toEqual([])
    t.history.undo()
    expect(t.store.get('h')).toBeDefined()
    t.state.selection = ['h']
    expect(t.keys.handle(key({ key: 'Backspace' }))).toBe(true)
    await Promise.resolve()
    expect(t.store.all()).toEqual([])
  })

  it('edit.delete is disabled while a text box is edited or the selection is gone', () => {
    const t = setup()
    t.state.selection = ['h']
    t.state.textEdit = {} as TextEdit
    expect(t.cmds.canExecute('edit.delete')).toBe(false)
    t.state.textEdit = null
    t.state.selection = ['missing']
    expect(t.cmds.canExecute('edit.delete')).toBe(false)
    t.deactivate()
    expect(t.cmds.canExecute('edit.delete')).toBe(false)
  })

  it('edit.deselect clears the selection on Escape, and lets Escape through without one', async () => {
    const t = setup()
    expect(t.keys.handle(key({ key: 'Escape' }))).toBe(false)
    t.state.selection = ['h']
    expect(t.keys.handle(key({ key: 'Escape' }))).toBe(true)
    await Promise.resolve()
    expect(t.state.selection).toEqual([])
    expect(t.store.get('h')).toBeDefined()
  })

  it('dispose unregisters the commands', () => {
    const t = setup()
    t.dispose()
    expect(t.cmds.has('edit.delete')).toBe(false)
    expect(t.cmds.has('edit.deselect')).toBe(false)
  })
})

describe('editSelected', () => {
  function session(...list: (HighlightAnnotation | FreeTextAnnotation)[]) {
    const store = new AnnotationStore()
    store.load(list)
    const history = new History(store)
    const doc = { getPage: async (_i: number) => ({ rotate: 0 }) }
    // Pages in file order: a page's rotation is its file page's /Rotate.
    const s = { store, history, doc, pageRotation: async (i: number) => (await s.doc.getPage(i + 1)).rotate }
    return s as unknown as DocumentSession
  }

  it('commits one update, skipping no-op edits', async () => {
    const s = session(hl)
    await editSelected(s, { ...hl, color: [1, 0, 0] })
    expect((s.store.get('h') as HighlightAnnotation).color).toEqual([1, 0, 0])
    expect(s.store.get('h')!.modifiedAt).not.toBe('')
    await editSelected(s, { ...(s.store.get('h') as HighlightAnnotation), modifiedAt: 'x' })
    s.history.undo()
    expect(s.store.get('h')).toEqual(hl)
    expect(s.history.canUndo).toBe(false)
  })

  it('re-lays out a text box whose font size changed', async () => {
    const text = 'the quick brown fox jumps over'
    const box: FreeTextAnnotation = {
      id: 'b', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
      rect: [10, 70, 110, 90], text, lines: layoutLines(text, 10, 100), fontSize: 10,
      textColor: [0, 0, 0], background: null,
    }
    const s = session(box)
    await editSelected(s, { ...box, fontSize: 20 })
    const a = s.store.get('b') as FreeTextAnnotation
    const lines = layoutLines(text, 20, 100)
    expect(a.lines).toEqual(lines)
    expect(a.rect).toEqual([10, 90 - boxHeight(lines.length, 20), 110, 90])
  })

  it('applies only the edited fields to the annotation as it is after the await', async () => {
    const text = 'the quick brown fox jumps over'
    const box: FreeTextAnnotation = {
      id: 'b', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
      rect: [10, 70, 110, 90], text, lines: layoutLines(text, 10, 100), fontSize: 10,
      textColor: [0, 0, 0], background: null,
    }
    const s = session(box)
    let release!: () => void
    s.doc.getPage = (() => new Promise((r) => (release = () => r({ rotate: 0 })))) as never
    const pending = editSelected(s, { ...box, fontSize: 20 })
    // Meanwhile the text colour changes (e.g. an undo/redo or another edit).
    s.store.update('b', { ...box, textColor: [1, 0, 0] })
    release()
    await pending
    const a = s.store.get('b') as FreeTextAnnotation
    expect(a.fontSize).toBe(20)
    expect(a.textColor).toEqual([1, 0, 0])
  })

  it('does nothing when the annotation vanished meanwhile', async () => {
    const s = session(hl)
    s.store.remove('h')
    await editSelected(s, { ...hl, color: [1, 0, 0] })
    expect(s.store.get('h')).toBeUndefined()
  })

  it('reports a failure with a toast instead of throwing', async () => {
    const text = 'abc'
    const box: FreeTextAnnotation = {
      id: 'b', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
      rect: [10, 70, 110, 90], text, lines: layoutLines(text, 10, 100), fontSize: 10,
      textColor: [0, 0, 0], background: null,
    }
    const s = session(box)
    s.doc.getPage = (async () => { throw new Error('boom') }) as never
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const show = vi.spyOn(toasts, 'show')
    await expect(editSelected(s, { ...box, fontSize: 20 })).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('Could not apply the change', 'error')
    err.mockRestore()
    show.mockRestore()
  })
})

describe('duplicate and flatten commands', () => {
  const hl2: HighlightAnnotation = { ...hl, id: 'h2', quads: [[20, 10, 30, 10, 20, 0, 30, 0]] }

  function setupTwo() {
    const t = setup()
    t.store.load([hl, hl2])
    t.state.selection = ['h', 'h2']
    return t
  }

  it('edit.duplicate (Ctrl+D) adds offset copies, selects them, one undo step', async () => {
    const t = setupTwo()
    expect(t.keys.handle(key({ key: 'd', ctrlKey: true }))).toBe(true)
    await Promise.resolve()
    const all = t.store.all()
    expect(all).toHaveLength(4)
    const copies = all.slice(2) as HighlightAnnotation[]
    expect(t.state.selection).toEqual(copies.map((a) => a.id))
    expect(copies.every((a) => a.id !== 'h' && a.id !== 'h2' && a.sourceRef === null)).toBe(true)
    const d = DUPLICATE_OFFSET
    expect(copies[0].quads).toEqual([[d, 10 - d, 10 + d, 10 - d, d, -d, 10 + d, -d]])
    t.history.undo()
    expect(t.store.all().map((a) => a.id)).toEqual(['h', 'h2'])
  })

  it('edit.flatten marks the selection flattened, deselects it, one undo step', async () => {
    const t = setupTwo()
    expect(await t.cmds.execute('edit.flatten')).toBe(true)
    expect(t.store.all().every((a) => a.flattened === true)).toBe(true)
    expect(t.state.selection).toEqual([])
    // Flattened annotations cannot be selected for further actions.
    t.state.selection = ['h']
    expect(t.cmds.canExecute('edit.flatten')).toBe(false)
    expect(t.cmds.canExecute('edit.duplicate')).toBe(false)
    expect(t.cmds.canExecute('edit.delete')).toBe(false)
    t.history.undo()
    expect(t.store.all().some((a) => a.flattened)).toBe(false)
  })

  it('edit.delete deletes the whole selection', async () => {
    const t = setupTwo()
    expect(await t.cmds.execute('edit.delete')).toBe(true)
    expect(t.store.all()).toEqual([])
    t.history.undo()
    expect(t.store.all().map((a) => a.id)).toEqual(['h', 'h2'])
  })

  it('duplicate and flatten are off while a text box is edited', () => {
    const t = setupTwo()
    t.state.textEdit = {} as TextEdit
    expect(t.cmds.canExecute('edit.duplicate')).toBe(false)
    expect(t.cmds.canExecute('edit.flatten')).toBe(false)
  })

  it('duplicatesOf gives independent copies with fresh ids', () => {
    const [c] = duplicatesOf([{ ...hl, sourceRef: '5R' }], 'now')
    expect(c.id).not.toBe('h')
    expect(c.sourceRef).toBeNull()
    expect(c.modifiedAt).toBe('now')
  })
})

describe('editAnnotations', () => {
  const text = 'the quick brown fox jumps over'
  const box = (id: string, page: number): FreeTextAnnotation => ({
    id, page, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
    rect: [10, 70, 110, 90], text, lines: layoutLines(text, 10, 100), fontSize: 10,
    textColor: [0, 0, 0], background: null, align: 'left',
  })

  function session(rotations: number[], ...list: FreeTextAnnotation[]) {
    const store = new AnnotationStore()
    store.load(list)
    const history = new History(store)
    const s = { store, history, pageRotation: async (i: number) => rotations[i] }
    return s as unknown as DocumentSession
  }

  it('edits several boxes as one undo step, each laid out on its own page', async () => {
    const a = box('a', 0)
    const b = box('b', 1)
    // Page 1 is turned 90°: the box's screen width is its PDF height (20).
    const s = session([0, 90], a, b)
    await editAnnotations(s, [{ ...a, fontSize: 20 }, { ...b, fontSize: 20 }])
    const got = (id: string) => s.store.get(id) as FreeTextAnnotation
    expect(got('a').lines).toEqual(layoutLines(text, 20, 100))
    expect(got('b').lines).toEqual(layoutLines(text, 20, 20))
    s.history.undo()
    expect(s.store.get('a')).toEqual(a)
    expect(s.store.get('b')).toEqual(b)
    expect(s.history.canUndo).toBe(false)
  })

  it('adds no undo step when nothing changed', async () => {
    const a = box('a', 0)
    const s = session([0], a)
    await editAnnotations(s, [{ ...a }])
    expect(s.history.canUndo).toBe(false)
  })
})

describe('z-order commands', () => {
  const hl2: HighlightAnnotation = { ...hl, id: 'h2' }
  const hl3: HighlightAnnotation = { ...hl, id: 'h3' }

  function setupThree() {
    const t = setup()
    t.store.load([hl, hl2, hl3])
    return t
  }
  const order = (t: ReturnType<typeof setup>) => t.store.byPage(0).map((a) => a.id)

  it('Ctrl+] / Ctrl+[ step the selection up / down, one undo step each', async () => {
    const t = setupThree()
    t.state.selection = ['h']
    expect(t.keys.handle(key({ key: ']', ctrlKey: true }))).toBe(true)
    await Promise.resolve()
    expect(order(t)).toEqual(['h2', 'h', 'h3'])
    expect(t.keys.handle(key({ key: '[', ctrlKey: true }))).toBe(true)
    await Promise.resolve()
    expect(order(t)).toEqual(['h', 'h2', 'h3'])
    t.history.undo()
    expect(order(t)).toEqual(['h2', 'h', 'h3'])
  })

  it('Ctrl+Shift+] / Ctrl+Shift+[ go to the top / bottom (also as typed with Shift: } and {)', async () => {
    const t = setupThree()
    t.state.selection = ['h']
    expect(t.keys.handle(key({ key: '}', ctrlKey: true, shiftKey: true }))).toBe(true)
    await Promise.resolve()
    expect(order(t)).toEqual(['h2', 'h3', 'h'])
    expect(t.keys.handle(key({ key: '{', ctrlKey: true, shiftKey: true }))).toBe(true)
    await Promise.resolve()
    expect(order(t)).toEqual(['h', 'h2', 'h3'])
    expect(t.keys.handle(key({ key: ']', ctrlKey: true, shiftKey: true }))).toBe(true)
    await Promise.resolve()
    expect(order(t)).toEqual(['h2', 'h3', 'h'])
  })

  it('a change that would move nothing is off (no undo step, the key passes through)', () => {
    const t = setupThree()
    t.state.selection = ['h']
    expect(t.cmds.canExecute('edit.sendToBack')).toBe(false)
    expect(t.cmds.canExecute('edit.sendBackward')).toBe(false)
    expect(t.keys.handle(key({ key: '[', ctrlKey: true }))).toBe(false)
    expect(t.cmds.canExecute('edit.bringToFront')).toBe(true)
    t.state.textEdit = {} as TextEdit
    expect(t.cmds.canExecute('edit.bringToFront')).toBe(false)
    t.state.textEdit = null
    t.state.selection = []
    expect(t.cmds.canExecute('edit.bringForward')).toBe(false)
    expect(t.history.canUndo).toBe(false)
  })
})
