import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import type { PageFrame, TextEdit } from '../../../src/core/registry/tools'
import type { ClipboardImage } from '../../../src/core/ipc/clipboard'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, FreeTextAnnotation, ShapeAnnotation } from '../../../src/core/session/model'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { blankViewport } from '../../../src/core/viewer/pageSource'
import '../../../src/annotations'
import { DUPLICATE_OFFSET } from '../../../src/tools/select/commands'
import {
  AnnotationClipboard, clipboardText, placePasted, registerClipboardCommands, spotAt,
  type ClipboardTarget, type PasteSpot, type SystemClipboard,
} from '../../../src/tools/select/clipboard'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { ctrlKey: true, ...init })
const settle = () => new Promise((r) => setTimeout(r, 0))

const box: ShapeAnnotation = {
  id: 'b', page: 0, sourceRef: 'R1', modifiedAt: '', author: 'Julie', kind: 'shape', shape: 'rect',
  rect: [100, 100, 200, 150], border: null, fill: { color: [1, 0, 0], opacity: 1 },
}
const note: FreeTextAnnotation = {
  id: 't', page: 1, sourceRef: null, modifiedAt: '', author: 'Julie', kind: 'freetext',
  rect: [10, 10, 60, 30], text: 'Hello', lines: ['Hello'], fontSize: 12, textColor: [0, 0, 0], background: null, align: 'left',
}
const PAGE = [0, 0, 600, 800] as const

/** A system clipboard that remembers the text written to it, like the real one. */
function fakeSystem(image: ClipboardImage | null = null) {
  const sys = {
    text: null as string | null,
    image,
    writeText: vi.fn(async (t: string) => void (sys.text = t)),
    readText: vi.fn(async () => sys.text),
    readImage: vi.fn(async () => sys.image),
  }
  return sys satisfies SystemClipboard
}

function setup(sessionId = 's1', sys = fakeSystem(), clip = new AnnotationClipboard()) {
  const store = new AnnotationStore()
  store.load([box, note])
  const history = new History(store)
  let committed = 0
  const session = { id: sessionId, store, history, commitPendingEdit: () => void committed++ } as unknown as DocumentSession
  const state = { selection: [] as string[], textEdit: null as TextEdit | null }
  let spot: PasteSpot | null = { page: 0, vp: blankViewport(600, 800, 1, 0), at: null }
  const pasteImage = vi.fn(async () => {})
  const target: ClipboardTarget = {
    session, state, pasteSpot: () => spot, select: (ids) => (state.selection = ids), pasteImage,
  }
  const cmds = new CommandRegistry()
  const keys = new KeybindingRegistry(cmds)
  const dispose = registerClipboardCommands(() => target, sys, clip, cmds, keys)
  return {
    store, history, state, cmds, keys, sys, clip, pasteImage, dispose,
    committed: () => committed, setSpot: (s: PasteSpot | null) => (spot = s),
  }
}

const added = (store: AnnotationStore, before: Annotation[]) => store.all().filter((a) => !before.some((b) => b.id === a.id))

describe('placePasted', () => {
  it('makes new copies shifted by the steps, on the target page', () => {
    const [c] = placePasted([box], 3, [...PAGE], 2, 'now')
    expect(c).toMatchObject({ kind: 'shape', page: 3, sourceRef: null, modifiedAt: 'now', author: 'Julie' })
    expect(c.id).not.toBe('b')
    const d = 2 * DUPLICATE_OFFSET
    expect((c as ShapeAnnotation).rect).toEqual([100 + d, 100 - d, 200 + d, 150 - d])
  })

  it('keeps the group together and on the page', () => {
    const far = { ...box, id: 'f', rect: [550, 20, 590, 60] } as ShapeAnnotation
    const out = placePasted([box, far], 0, [...PAGE], 1) as ShapeAnnotation[]
    // Shifted right by 12, the far one would end at 602: the whole group moves back by 2.
    expect(out[1].rect[2]).toBeCloseTo(600)
    expect(out[0].rect[0]).toBeCloseTo(110)
    expect(out[1].rect[1]).toBeCloseTo(8)
    // On a smaller page the group keeps its top-left corner on it.
    const small = placePasted([box], 0, [0, 0, 50, 50], 0) as ShapeAnnotation[]
    expect(small[0].rect[0]).toBeCloseTo(0)
    expect(small[0].rect[3]).toBeCloseTo(50)
  })
})

describe('spotAt', () => {
  const vp = blankViewport(600, 800, 1, 0)
  const frames = new Map<number, () => PageFrame | null>([
    [0, () => ({ vp, origin: [0, 0] })],
    [1, () => ({ vp, origin: [0, 810] })],
  ])

  it('finds the page under the pointer and the PDF point there', () => {
    expect(spotAt(frames, [100, 910], 0)).toEqual({ page: 1, vp, at: [100, 700] })
  })

  it('falls back to the visible page without a pointer on a page, null when it is not mounted', () => {
    expect(spotAt(frames, [100, 805], 1)).toEqual({ page: 1, vp, at: null })
    expect(spotAt(frames, null, 0)).toEqual({ page: 0, vp, at: null })
    expect(spotAt(frames, null, 5)).toBeNull()
  })
})

describe('clipboardText', () => {
  it('is the text of copied text boxes, else a label', () => {
    expect(clipboardText([box, note])).toBe('Hello')
    expect(clipboardText([box])).toBe('1 annotation (JuliePDF)')
    expect(clipboardText([box, box])).toBe('2 annotations (JuliePDF)')
  })
})

describe('clipboard commands', () => {
  it('copy and cut are off without a selection, so Ctrl+C reaches the page text', () => {
    const t = setup()
    expect(t.keys.handle(key({ key: 'c' }))).toBe(false)
    expect(t.keys.handle(key({ key: 'x' }))).toBe(false)
    t.state.selection = ['b']
    t.state.textEdit = {} as TextEdit
    expect(t.cmds.canExecute('edit.copy')).toBe(false)
    expect(t.cmds.canExecute('edit.paste')).toBe(false)
  })

  it('Ctrl+C then Ctrl+V pastes offset copies on the page, selected, as one undo step', async () => {
    const t = setup()
    t.state.selection = ['b']
    expect(t.keys.handle(key({ key: 'c' }))).toBe(true)
    await settle()
    expect(t.sys.text).toBe('1 annotation (JuliePDF)')
    const before = t.store.all()
    expect(t.keys.handle(key({ key: 'v' }))).toBe(true)
    await settle()
    const [c] = added(t.store, before) as ShapeAnnotation[]
    expect(c.rect).toEqual([112, 88, 212, 138])
    expect(t.state.selection).toEqual([c.id])
    expect(t.committed()).toBe(1)
    // A second paste steps further.
    t.keys.handle(key({ key: 'v' }))
    await settle()
    const [c2] = added(t.store, [...before, c]) as ShapeAnnotation[]
    expect(c2.rect).toEqual([124, 76, 224, 126])
    t.history.undo()
    t.history.undo()
    expect(t.store.all()).toEqual(before)
  })

  it('pastes onto another page at the same place, without the offset', async () => {
    const t = setup()
    t.state.selection = ['b']
    t.keys.handle(key({ key: 'c' }))
    t.setSpot({ page: 2, vp: blankViewport(600, 800, 1, 0), at: [5, 5] })
    const before = t.store.all()
    t.keys.handle(key({ key: 'v' }))
    await settle()
    const [c] = added(t.store, before) as ShapeAnnotation[]
    expect(c).toMatchObject({ page: 2, rect: [100, 100, 200, 150] })
  })

  it('Ctrl+X deletes the selection (one undo step); pasting puts it back in place', async () => {
    const t = setup()
    t.state.selection = ['b']
    t.keys.handle(key({ key: 'x' }))
    await settle()
    expect(t.store.get('b')).toBeUndefined()
    expect(t.state.selection).toEqual([])
    t.keys.handle(key({ key: 'v' }))
    await settle()
    const [c] = t.store.all().filter((a) => a.kind === 'shape') as ShapeAnnotation[]
    expect(c.rect).toEqual(box.rect)
    expect(c.id).not.toBe('b')
    t.history.undo()
    t.history.undo()
    expect(t.store.get('b')).toBeDefined()
  })

  it('works across tabs: one clipboard, pasted into another session', async () => {
    const sys = fakeSystem()
    const clip = new AnnotationClipboard()
    const a = setup('s1', sys, clip)
    a.state.selection = ['t']
    a.keys.handle(key({ key: 'c' }))
    a.dispose()
    const b = setup('s2', sys, clip)
    b.setSpot({ page: 1, vp: blankViewport(600, 800, 1, 0), at: null })
    const before = b.store.all()
    b.keys.handle(key({ key: 'v' }))
    await settle()
    const [c] = added(b.store, before) as FreeTextAnnotation[]
    expect(c).toMatchObject({ kind: 'freetext', page: 1, text: 'Hello', rect: [10, 10, 60, 30] })
  })

  it('pastes the system clipboard image when something else was copied since', async () => {
    const img = { width: 1, height: 1, rgba: new Uint8Array(4) }
    const t = setup('s1', fakeSystem(img))
    t.state.selection = ['b']
    t.keys.handle(key({ key: 'c' }))
    await settle()
    t.sys.text = null // another app copied an image
    const before = t.store.all()
    t.keys.handle(key({ key: 'v' }))
    await settle()
    expect(t.store.all()).toEqual(before)
    expect(t.pasteImage).toHaveBeenCalledWith(expect.objectContaining({ page: 0 }), img)
  })

  it('pastes an image with nothing copied in the app, and nothing without a page', async () => {
    const img = { width: 1, height: 1, rgba: new Uint8Array(4) }
    const t = setup('s1', fakeSystem(img))
    t.keys.handle(key({ key: 'v' }))
    await settle()
    expect(t.pasteImage).toHaveBeenCalledOnce()
    t.setSpot(null)
    t.keys.handle(key({ key: 'v' }))
    await settle()
    expect(t.pasteImage).toHaveBeenCalledOnce()
  })

  it('still pastes the annotations when the marker could not be written, and matches CRLF text', async () => {
    const sys = fakeSystem()
    sys.writeText.mockRejectedValueOnce(new Error('busy'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = setup('s1', sys)
    t.state.selection = ['b']
    t.keys.handle(key({ key: 'c' }))
    let before = t.store.all()
    t.keys.handle(key({ key: 'v' }))
    await settle()
    expect(added(t.store, before)).toHaveLength(1)
    spy.mockRestore()

    const multi = { ...note, id: 'm', text: 'a\nb' }
    t.store.load([multi])
    t.state.selection = ['m']
    t.keys.handle(key({ key: 'c' }))
    await settle()
    sys.text = 'a\r\nb'
    before = t.store.all()
    t.keys.handle(key({ key: 'v' }))
    await settle()
    expect(added(t.store, before)).toHaveLength(1)
  })

  it('dispose unregisters the commands', () => {
    const t = setup()
    t.dispose()
    expect(t.cmds.has('edit.copy')).toBe(false)
    expect(t.cmds.has('edit.cut')).toBe(false)
    expect(t.cmds.has('edit.paste')).toBe(false)
  })
})
