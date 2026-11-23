import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import type { TextEdit } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, FreeTextAnnotation, HighlightAnnotation, Rect } from '../../../src/core/session/model'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import '../../../src/annotations'
import {
  NUDGE_BIG_STEP, NUDGE_MERGE_MS, NUDGE_STEP, nudged, registerNudgeCommands, screenShift,
} from '../../../src/tools/select/nudge'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

const box: FreeTextAnnotation = {
  id: 'b', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
  rect: [100, 100, 200, 120], text: 'hi', lines: ['hi'], fontSize: 10, textColor: [0, 0, 0], background: null,
}
const hl: HighlightAnnotation = {
  id: 'h', page: 1, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
  quads: [[10, 20, 30, 20, 10, 10, 30, 10]], color: [1, 1, 0], opacity: 0.4,
}

const PAGE: Rect = [0, 0, 612, 792]

function setup(rotations: number[] = [0, 0]) {
  const store = new AnnotationStore()
  store.load([box, hl])
  const history = new History(store)
  const session = {
    store,
    history,
    pageRotation: async (p: number) => rotations[p] ?? 0,
    pageBox: async () => PAGE,
  } as unknown as DocumentSession
  const state = { selection: [] as string[], textEdit: null as TextEdit | null }
  const cmds = new CommandRegistry()
  const keys = new KeybindingRegistry(cmds)
  let time = 0
  const dispose = registerNudgeCommands(() => ({ session, state }), cmds, keys, () => time)
  /** Presses a key and waits for the move to land. */
  const press = async (init: KeyboardEventInit) => {
    const handled = keys.handle(key(init))
    await new Promise((r) => setTimeout(r, 0))
    return handled
  }
  return { store, history, state, cmds, dispose, press, advance: (ms: number) => (time += ms) }
}

const rectOf = (a: Annotation | null | undefined) => (a as FreeTextAnnotation).rect

describe('screenShift', () => {
  it('maps screen right/down to PDF space for each page rotation', () => {
    expect(screenShift(1, 2, 0)).toEqual([1, -2])
    expect(screenShift(1, 2, 90)).toEqual([2, 1])
    expect(screenShift(1, 2, 180)).toEqual([-1, 2])
    expect(screenShift(1, 2, 270)).toEqual([-2, -1])
    expect(screenShift(1, 2, -90)).toEqual([-2, -1])
  })
})

describe('nudged', () => {
  it('moves by the shift, held on the page; null when it cannot move', () => {
    expect(rectOf(nudged(box, 5, -3, PAGE))).toEqual([105, 97, 205, 117])
    expect(nudged({ ...box, rect: [0, 100, 100, 120] }, -1, 0, PAGE)).toBeNull()
    expect(rectOf(nudged({ ...box, rect: [5, 100, 105, 120] }, -10, 0, PAGE))).toEqual([0, 100, 100, 120])
    // Already partly off the page: it may stay there, and move back on.
    const off: FreeTextAnnotation = { ...box, rect: [-20, 100, 80, 120] }
    expect(nudged(off, -1, 0, PAGE)).toBeNull()
    expect(rectOf(nudged(off, 1, 0, PAGE))).toEqual([-19, 100, 81, 120])
    expect(rectOf(nudged(box, -500, 0, null))).toEqual([-400, 100, -300, 120])
  })
})

describe('nudge commands', () => {
  it('arrow keys move the selection one step, Shift+arrow a big step, in screen directions', async () => {
    const t = setup()
    t.state.selection = ['b']
    expect(await t.press({ key: 'ArrowRight' })).toBe(true)
    expect(rectOf(t.store.get('b'))).toEqual([100 + NUDGE_STEP, 100, 200 + NUDGE_STEP, 120])
    expect(await t.press({ key: 'ArrowUp', shiftKey: true })).toBe(true)
    expect(rectOf(t.store.get('b'))).toEqual([101, 100 + NUDGE_BIG_STEP, 201, 120 + NUDGE_BIG_STEP])
    await t.press({ key: 'ArrowDown' })
    await t.press({ key: 'ArrowLeft', shiftKey: true })
    expect(rectOf(t.store.get('b'))).toEqual([91, 109, 191, 129])
    expect(t.store.get('b')!.modifiedAt).not.toBe('')
  })

  it('follows the page rotation and moves every selected kind', async () => {
    const t = setup([0, 90])
    t.state.selection = ['b', 'h']
    await t.press({ key: 'ArrowRight' })
    expect(rectOf(t.store.get('b'))).toEqual([101, 100, 201, 120])
    // Screen right is +y on a page turned 90 degrees.
    expect((t.store.get('h') as HighlightAnnotation).quads).toEqual([[10, 21, 30, 21, 10, 11, 30, 11]])
  })

  it('is off without a selection or while a text box is edited, so the keys pass through', async () => {
    const t = setup()
    expect(await t.press({ key: 'ArrowRight' })).toBe(false)
    t.state.selection = ['b']
    t.state.textEdit = {} as TextEdit
    expect(await t.press({ key: 'ArrowRight' })).toBe(false)
    expect(t.store.get('b')).toEqual(box)
  })

  it('merges quick presses on the same selection into one undo step', async () => {
    const t = setup()
    t.state.selection = ['b']
    await t.press({ key: 'ArrowRight' })
    t.advance(NUDGE_MERGE_MS - 1)
    await t.press({ key: 'ArrowRight' })
    t.advance(10)
    await t.press({ key: 'ArrowDown', shiftKey: true })
    expect(rectOf(t.store.get('b'))).toEqual([102, 90, 202, 110])
    t.history.undo()
    expect(t.store.get('b')).toEqual(box)
    expect(t.history.canUndo).toBe(false)
  })

  it('starts a new undo step after a pause or on another selection', async () => {
    const t = setup()
    t.state.selection = ['b']
    await t.press({ key: 'ArrowRight' })
    t.advance(NUDGE_MERGE_MS)
    await t.press({ key: 'ArrowRight' }) // after a pause
    t.state.selection = ['b', 'h']
    await t.press({ key: 'ArrowRight' }) // another selection
    t.state.selection = ['b']
    await t.press({ key: 'ArrowRight' }) // back to the first one
    t.history.undo()
    expect(rectOf(t.store.get('b'))).toEqual([103, 100, 203, 120])
    t.history.undo()
    expect(rectOf(t.store.get('b'))).toEqual([102, 100, 202, 120])
    t.history.undo()
    expect(rectOf(t.store.get('b'))).toEqual([101, 100, 201, 120])
    t.history.undo()
    expect(t.store.get('b')).toEqual(box)
  })

  it('does not merge into a step made by something else in between', async () => {
    const t = setup()
    t.state.selection = ['b']
    await t.press({ key: 'ArrowRight' })
    t.history.execute({ label: 'other', do: () => {}, undo: () => {} })
    await t.press({ key: 'ArrowRight' })
    t.history.undo()
    expect(rectOf(t.store.get('b'))).toEqual([101, 100, 201, 120])
  })

  it('dispose unregisters the commands', () => {
    const t = setup()
    t.dispose()
    expect(t.cmds.has('edit.nudgeLeft')).toBe(false)
    expect(t.cmds.has('edit.nudgeDownFar')).toBe(false)
  })
})
