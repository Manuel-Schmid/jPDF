import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  savePdf: vi.fn(),
  askToSave: vi.fn(),
  saveDialog: vi.fn(),
  pathExists: vi.fn(),
}))
vi.mock('../../src/core/ipc/api', async (orig) => ({
  ...(await orig<typeof import('../../src/core/ipc/api')>()),
  savePdf: h.savePdf,
  pathExists: h.pathExists,
}))
vi.mock('../../src/app/ConfirmClose.svelte', () => ({ askToSave: h.askToSave }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: h.saveDialog }))

import { confirmAndClose, confirmCloseAll, registerSaveCommands, saveSession, saveSessionAs } from '../../src/app/saveFlow'
import { commands } from '../../src/core/registry/commands'
import { addAnnotations, deleteAnnotations, flattenAnnotations, reorderAnnotations, updateAnnotation } from '../../src/core/session/commands'
import { History } from '../../src/core/session/history.svelte'
import type { InkAnnotation } from '../../src/core/session/model'
import type { PageSpec } from '../../src/core/session/pages'
import type { DocumentSession } from '../../src/core/session/session.svelte'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import { tabs } from '../../src/app/tabs.svelte'
import { toasts } from '../../src/ui/toasts.svelte'

function ink(id: string, sourceRef: string | null = null, author = 'JuliePDF'): InkAnnotation {
  return {
    kind: 'ink', id, page: 0, sourceRef, modifiedAt: '2026-11-18T10:00:00Z', author,
    strokes: [[[0, 0], [10, 10]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
  }
}

let sessionCount = 0

function fakeSession(path = 'C:\\docs\\a.pdf', loaded: InkAnnotation[] = []) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const s = {
    id: `session-${++sessionCount}`,
    path,
    fileName: path.split('\\').pop()!,
    store,
    history,
    get dirty() {
      return history.isDirty
    },
    setPath: vi.fn((p: string) => {
      s.path = p
      s.fileName = p.split('\\').pop()!
    }),
    suppress: vi.fn(),
    /** Page plan to save (null: pages unchanged), see DocumentSession.pagePlan. */
    plan: null as PageSpec[] | null,
    pagePlan: vi.fn((): Promise<PageSpec[]> | null => (s.plan ? Promise.resolve(s.plan) : null)),
    /** The page list (identity only matters: page operations replace it). */
    pages: [] as unknown[],
    /** Set when the session no longer matches its file and must not save. */
    broken: false,
    /** What loadSaved() reads from the saved file. */
    reloaded: [] as InkAnnotation[],
    loadSaved: vi.fn(async () => ({ annotations: s.reloaded })),
    applyReload: vi.fn((loaded: { annotations: InkAnnotation[] }) => {
      store.load(loaded.annotations)
      history.reset()
    }),
    pendingEdit: null as (() => void) | null,
    commitPendingEdit() {
      const commit = s.pendingEdit
      s.pendingEdit = null
      commit?.()
    },
  }
  return s as typeof s & DocumentSession
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  h.savePdf.mockReset()
  h.askToSave.mockReset()
  h.saveDialog.mockReset()
  h.pathExists.mockReset()
  h.pathExists.mockResolvedValue(false)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const t of [...toasts.items]) toasts.dismiss(t.id)
  tabs.sessions = []
  tabs.activeId = null
  vi.restoreAllMocks()
})

describe('saveSession', () => {
  it('sends changedSince as upserts and deletedSourceRefs as deletes', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old1', '10R'), ink('old2', '12R')])
    s.history.execute(deleteAnnotations([s.store.get('old1')!]))
    s.history.execute(addAnnotations([ink('new')]))
    h.savePdf.mockResolvedValue({ refs: { new: '20R' } })
    expect(await saveSession(s)).toBe(true)
    expect(h.savePdf).toHaveBeenCalledWith('C:\\docs\\a.pdf', 'C:\\docs\\a.pdf', [ink('new')], [{ id: 'old1', sourceRef: '10R' }])
  })

  it('sends the z-order of reordered pages; the save clears it', async () => {
    const s = fakeSession(undefined, [ink('a', '10R'), ink('b', '11R')])
    s.history.execute(reorderAnnotations([s.store.get('a')!], 'front'))
    expect(s.dirty).toBe(true)
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSession(s)).toBe(true)
    const order = [{ page: 0, annotations: [{ id: 'b', sourceRef: '11R' }, { id: 'a', sourceRef: '10R' }] }]
    expect(h.savePdf).toHaveBeenCalledWith('C:\\docs\\a.pdf', 'C:\\docs\\a.pdf', [], [], undefined, order)
    expect(s.dirty).toBe(false)
    expect(s.store.pageOrders()).toEqual([])
  })

  it('on success calls markSaved(refs) and markClean', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    const markSaved = vi.spyOn(s.store, 'markSaved')
    const markClean = vi.spyOn(s.history, 'markClean')
    h.savePdf.mockResolvedValue({ refs: { new: '20R' } })
    await saveSession(s)
    expect(markSaved).toHaveBeenCalledWith({ new: '20R' }, [], [])
    expect(markClean).toHaveBeenCalled()
    expect(s.dirty).toBe(false)
    expect(s.store.get('new')!.sourceRef).toBe('20R')
    expect(s.suppress).toHaveBeenCalledWith(['20R'])
  })

  it('on Locked shows error toast with Save As action and keeps dirty', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    h.savePdf.mockRejectedValue({ code: 'Locked', message: 'C:\\docs\\a.pdf: denied' })
    expect(await saveSession(s)).toBe(false)
    expect(s.dirty).toBe(true)
    expect(toasts.items).toHaveLength(1)
    expect(toasts.items[0].kind).toBe('error')
    expect(toasts.items[0].action?.label).toBe('Save As…')
    expect(s.store.changedSince().map((a) => a.id)).toEqual(['new'])
  })

  it('on other errors shows the message without an action and keeps dirty', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    h.savePdf.mockRejectedValue({ code: 'InvalidPdf', message: 'unsupported annotation kind' })
    expect(await saveSession(s)).toBe(false)
    expect(s.dirty).toBe(true)
    expect(toasts.items[0].message).toContain('unsupported annotation kind')
    expect(toasts.items[0].action).toBeUndefined()
  })

  it('sends author "JuliePDF" when an annotation has none', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new', null, '')]))
    h.savePdf.mockResolvedValue({ refs: {} })
    await saveSession(s)
    expect(h.savePdf.mock.calls[0][2][0].author).toBe('JuliePDF')
  })

  it('to another path writes from the current path and points the session at the target', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSession(s, 'D:\\out\\b.pdf')).toBe(true)
    expect(h.savePdf).toHaveBeenCalledWith('C:\\docs\\a.pdf', 'D:\\out\\b.pdf', [], [])
    expect(s.path).toBe('D:\\out\\b.pdf')
    expect(s.fileName).toBe('b.pdf')
  })

  it('keeps edits made while the save is in flight dirty and saves them next time', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.history.execute(addAnnotations([ink('a')]))
    const first = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(first.promise)
    const saving = saveSession(s)
    s.history.execute(addAnnotations([ink('b')]))
    s.history.execute(updateAnnotation(s.store.get('a')!, { ...ink('a'), width: 5 }))
    s.history.execute(deleteAnnotations([s.store.get('old')!]))
    first.resolve({ refs: { a: '20R' } })
    expect(await saving).toBe(true)
    expect(s.dirty).toBe(true)

    h.savePdf.mockResolvedValueOnce({ refs: { b: '21R' } })
    await saveSession(s)
    const [, , upserts, deletes] = h.savePdf.mock.calls[1]
    expect(upserts.map((a: InkAnnotation) => [a.id, a.sourceRef, a.width])).toEqual([
      ['a', '20R', 5],
      ['b', null, 2],
    ])
    expect(deletes).toEqual([{ id: 'old', sourceRef: '10R' }])
    expect(s.dirty).toBe(false)
  })

  it('a second save waits for the one in flight', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    const first = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ refs: {} })
    const one = saveSession(s)
    const two = saveSession(s, 'C:\\docs\\copy.pdf')
    await Promise.resolve()
    expect(h.savePdf).toHaveBeenCalledTimes(1)
    first.resolve({ refs: { a: '20R' } })
    expect(await Promise.all([one, two])).toEqual([true, true])
    expect(h.savePdf.mock.calls[1].slice(0, 3)).toEqual(['C:\\docs\\a.pdf', 'C:\\docs\\copy.pdf', []])
  })
})

describe('saving page changes', () => {
  const plan: PageSpec[] = [{ kind: 'source', index: 0, rotate: 90 }, { kind: 'blank', width: 10, height: 20, rotate: 0 }]

  it('sends no page plan and keeps the history when the pages are unchanged', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    h.savePdf.mockResolvedValue({ refs: { a: '20R' } })
    await saveSession(s)
    expect(h.savePdf.mock.calls[0]).toHaveLength(4)
    expect(s.loadSaved).not.toHaveBeenCalled()
    expect(s.history.canUndo).toBe(true)
  })

  it('sends the page plan, then reloads from the saved file with an empty history', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.history.execute(addAnnotations([ink('a')]))
    s.plan = plan
    s.reloaded = [ink('old', '30R'), ink('a', '31R')]
    h.savePdf.mockResolvedValue({ refs: { a: '20R' } })
    expect(await saveSession(s)).toBe(true)
    expect(h.savePdf).toHaveBeenCalledWith('C:\\docs\\a.pdf', 'C:\\docs\\a.pdf', [ink('a')], [], plan, [])
    expect(s.applyReload).toHaveBeenCalledOnce()
    expect(s.store.get('a')!.sourceRef).toBe('31R')
    expect(s.history.canUndo).toBe(false)
    expect(s.history.canRedo).toBe(false)
    expect(s.dirty).toBe(false)
  })

  it('Save As with page changes reloads from the new file', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    s.plan = plan
    h.savePdf.mockResolvedValue({ refs: {} })
    s.loadSaved.mockImplementation(async () => {
      expect(s.path).toBe('D:\\out\\b.pdf')
      return { annotations: [] }
    })
    expect(await saveSession(s, 'D:\\out\\b.pdf')).toBe(true)
    expect(s.applyReload).toHaveBeenCalledOnce()
  })

  it('keeps annotation edits made while saving (dirty, undoable) across the reload', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R'), ink('gone', '11R')])
    s.plan = plan
    s.reloaded = [ink('old', '30R'), ink('gone', '31R')]
    const first = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(first.promise)
    const saving = saveSession(s)
    s.history.execute(addAnnotations([ink('b')]))
    s.history.execute(updateAnnotation(s.store.get('old')!, { ...ink('old', '10R'), width: 7 }))
    s.history.execute(deleteAnnotations([s.store.get('gone')!]))
    first.resolve({ refs: {} })
    expect(await saving).toBe(true)
    expect(s.store.all().map((a) => [a.id, a.sourceRef, (a as InkAnnotation).width])).toEqual([
      ['old', '30R', 7],
      ['b', null, 2],
    ])
    expect(s.dirty).toBe(true)
    s.history.undo()
    expect(s.store.all().map((a) => a.id)).toEqual(['old', 'gone'])
    expect(s.history.canUndo).toBe(false)
  })

  it('keeps edits made while the saved file is being loaded', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.plan = plan
    const load = deferred<{ annotations: InkAnnotation[] }>()
    s.loadSaved.mockReturnValueOnce(load.promise)
    h.savePdf.mockResolvedValue({ refs: {} })
    const saving = saveSession(s)
    await vi.waitFor(() => expect(s.loadSaved).toHaveBeenCalled())
    s.history.execute(addAnnotations([ink('late')]))
    load.resolve({ annotations: [ink('old', '30R')] })
    expect(await saving).toBe(true)
    expect(s.store.all().map((a) => a.id)).toEqual(['old', 'late'])
    expect(s.dirty).toBe(true)
  })

  it('drops edits with a warning when a page operation happened while loading', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.plan = plan
    const load = deferred<{ annotations: InkAnnotation[] }>()
    s.loadSaved.mockReturnValueOnce(load.promise)
    h.savePdf.mockResolvedValue({ refs: {} })
    const saving = saveSession(s)
    await vi.waitFor(() => expect(s.loadSaved).toHaveBeenCalled())
    s.history.execute(addAnnotations([ink('late')]))
    s.pages = []
    load.resolve({ annotations: [ink('old', '30R')] })
    expect(await saving).toBe(true)
    expect(s.store.all().map((a) => a.id)).toEqual(['old'])
    expect(toasts.items.at(-1)?.message).toBe('Changes made while saving were not kept')
  })

  it('warns when a page operation alone was made while loading', async () => {
    const s = fakeSession('C:\docs\a.pdf', [ink('old', '10R')])
    s.plan = plan
    const load = deferred<{ annotations: InkAnnotation[] }>()
    s.loadSaved.mockReturnValueOnce(load.promise)
    h.savePdf.mockResolvedValue({ refs: {} })
    const saving = saveSession(s)
    await vi.waitFor(() => expect(s.loadSaved).toHaveBeenCalled())
    s.pages = []
    load.resolve({ annotations: [ink('old', '30R')] })
    expect(await saving).toBe(true)
    expect(toasts.items.at(-1)?.message).toBe('Changes made while saving were not kept')
  })

  it('retries a failed reload once', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.plan = plan
    h.savePdf.mockResolvedValue({ refs: {} })
    s.loadSaved.mockRejectedValueOnce(new Error('busy'))
    s.reloaded = [ink('old', '30R')]
    expect(await saveSession(s)).toBe(true)
    expect(s.loadSaved).toHaveBeenCalledTimes(2)
    expect(s.broken).toBe(false)
    expect(s.store.get('old')!.sourceRef).toBe('30R')
  })

  it('after a reload that keeps failing the session cannot save and closes without asking', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.history.execute(addAnnotations([ink('a')]))
    s.plan = plan
    h.savePdf.mockResolvedValue({ refs: {} })
    s.loadSaved.mockRejectedValue(new Error('gone'))
    expect(await saveSession(s)).toBe(true)
    expect(s.loadSaved).toHaveBeenCalledTimes(2)
    expect(s.applyReload).not.toHaveBeenCalled()
    expect(s.broken).toBe(true)
    expect(toasts.items.at(-1)).toMatchObject({ kind: 'error' })
    expect(toasts.items.at(-1)?.message).toContain('could not be reloaded')
    h.savePdf.mockClear()
    expect(await saveSession(s)).toBe(false)
    expect(h.savePdf).not.toHaveBeenCalled()
    expect(toasts.items.at(-1)?.message).toContain('Close and reopen')
    h.saveDialog.mockResolvedValue('D:\\out\\b.pdf')
    expect(await saveSessionAs(s)).toBe(false)
    expect(h.saveDialog).not.toHaveBeenCalled()
    expect(h.savePdf).not.toHaveBeenCalled()
    expect(await confirmAndClose(s)).toBe(true)
    expect(h.askToSave).not.toHaveBeenCalled()
  })
})

describe('sourceRefs across undo and saves', () => {
  it('add, edit, save, undo, save: the upsert keeps the saved ref (no duplicate)', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    s.history.execute(updateAnnotation(s.store.get('a')!, { ...ink('a'), width: 5 }))
    h.savePdf.mockResolvedValueOnce({ refs: { a: '20R' } })
    await saveSession(s)
    s.history.undo()
    expect(s.store.get('a')!.sourceRef).toBe('20R')
    h.savePdf.mockResolvedValueOnce({ refs: { a: '20R' } })
    await saveSession(s)
    const [, , upserts, deletes] = h.savePdf.mock.calls[1]
    expect(upserts.map((a: InkAnnotation) => [a.id, a.sourceRef, a.width])).toEqual([['a', '20R', 2]])
    expect(deletes).toEqual([])
  })

  it('load, delete, save, undo, save: re-added as a new object, 10R not deleted again', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.history.execute(deleteAnnotations([s.store.get('old')!]))
    h.savePdf.mockResolvedValueOnce({ refs: {} })
    await saveSession(s)
    expect(h.savePdf.mock.calls[0][3]).toEqual([{ id: 'old', sourceRef: '10R' }])
    s.history.undo()
    expect(s.store.get('old')!.sourceRef).toBeNull()
    h.savePdf.mockResolvedValueOnce({ refs: { old: '30R' } })
    await saveSession(s)
    const [, , upserts, deletes] = h.savePdf.mock.calls[1]
    expect(upserts.map((a: InkAnnotation) => [a.id, a.sourceRef])).toEqual([['old', null]])
    expect(deletes).toEqual([])
    expect(s.store.get('old')!.sourceRef).toBe('30R')
  })

  it('undo during an in-flight save still ends with correct refs', async () => {
    const s = fakeSession('C:\\docs\\a.pdf', [ink('old', '10R')])
    s.history.execute(addAnnotations([ink('a')]))
    s.history.execute(deleteAnnotations([s.store.get('old')!]))
    const first = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(first.promise)
    const saving = saveSession(s)
    expect(h.savePdf.mock.calls[0].slice(2)).toEqual([[ink('a')], [{ id: 'old', sourceRef: '10R' }]])
    s.history.undo() // re-adds old (its file object is being deleted)
    s.history.undo() // removes a (its file object is being written)
    first.resolve({ refs: { a: '20R' } })
    expect(await saving).toBe(true)
    expect(s.dirty).toBe(true)
    expect(s.store.get('old')!.sourceRef).toBeNull()

    h.savePdf.mockResolvedValueOnce({ refs: { old: '31R' } })
    await saveSession(s)
    const [, , upserts, deletes] = h.savePdf.mock.calls[1]
    expect(upserts.map((a: InkAnnotation) => [a.id, a.sourceRef])).toEqual([['old', null]])
    expect(deletes).toEqual([{ id: 'a', sourceRef: '20R' }])
    expect(s.dirty).toBe(false)
  })

  it('a failed save does not block the saves queued behind it', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    let fail!: (e: unknown) => void
    h.savePdf
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      .mockResolvedValueOnce({ refs: { a: '20R' } })
    const one = saveSession(s)
    const two = saveSession(s)
    fail({ code: 'Io', message: 'disk full' })
    expect(await one).toBe(false)
    expect(await two).toBe(true)
    expect(s.dirty).toBe(false)
  })
})

describe('saveSessionAs', () => {
  it('asks for a .pdf target named like the current file and saves there', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    h.saveDialog.mockResolvedValue('D:\\out\\b.pdf')
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSessionAs(s)).toBe(true)
    expect(h.saveDialog).toHaveBeenCalledWith({
      defaultPath: 'C:\\docs\\a.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    expect(s.path).toBe('D:\\out\\b.pdf')
  })

  it('refuses a target that is open in another tab', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    const other = fakeSession('D:\\out\\b.pdf')
    tabs.sessions = [s, other]
    h.saveDialog.mockResolvedValue('d:\\OUT\\B.pdf')
    expect(await saveSessionAs(s)).toBe(false)
    expect(h.savePdf).not.toHaveBeenCalled()
    expect(toasts.items.map((t) => [t.kind, t.message])).toEqual([
      ['error', 'This file is open in another tab — close it first'],
    ])
    expect(s.path).toBe('C:\\docs\\a.pdf')
  })

  it('may save over its own file', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    tabs.sessions = [s]
    h.saveDialog.mockResolvedValue('C:\\docs\\a.pdf')
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSessionAs(s)).toBe(true)
  })

  it('appends .pdf to a typed name and saves when that file does not exist', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    h.saveDialog.mockResolvedValue('D:\\out\\b')
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSessionAs(s)).toBe(true)
    expect(h.pathExists).toHaveBeenCalledWith('D:\\out\\b.pdf')
    expect(h.savePdf).toHaveBeenCalledWith('C:\\docs\\a.pdf', 'D:\\out\\b.pdf', [], [])
  })

  it('refuses when the appended .pdf name exists (the dialog never confirmed replacing it)', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    h.saveDialog.mockResolvedValue('D:\\out\\b')
    h.pathExists.mockResolvedValue(true)
    expect(await saveSessionAs(s)).toBe(false)
    expect(h.savePdf).not.toHaveBeenCalled()
    expect(toasts.items).toHaveLength(1)
    expect(toasts.items[0].kind).toBe('error')
    expect(toasts.items[0].message).toContain('b.pdf already exists')
  })

  it('does not second-guess a .pdf path the dialog returned', async () => {
    const s = fakeSession('C:\\docs\\a.pdf')
    h.saveDialog.mockResolvedValue('D:\\out\\b.pdf')
    h.pathExists.mockResolvedValue(true)
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSessionAs(s)).toBe(true)
    expect(h.pathExists).not.toHaveBeenCalled()
  })

  it('does nothing when the dialog is cancelled', async () => {
    const s = fakeSession()
    h.saveDialog.mockResolvedValue(null)
    expect(await saveSessionAs(s)).toBe(false)
    expect(h.savePdf).not.toHaveBeenCalled()
  })
})

describe('confirmAndClose', () => {
  it('returns true without prompting when not dirty', async () => {
    const s = fakeSession()
    expect(await confirmAndClose(s)).toBe(true)
    expect(h.askToSave).not.toHaveBeenCalled()
  })

  it('Save keeps the tab when edits made during the save are still unsaved', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    h.askToSave.mockResolvedValue('save')
    const write = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(write.promise)
    const closing = confirmAndClose(s)
    await vi.waitFor(() => expect(h.savePdf).toHaveBeenCalled())
    s.history.execute(addAnnotations([ink('b')]))
    write.resolve({ refs: { a: '20R' } })
    expect(await closing).toBe(false)
  })

  it('Save saves and closes; a failed save keeps the tab', async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    h.askToSave.mockResolvedValue('save')
    h.savePdf.mockRejectedValueOnce({ code: 'Io', message: 'disk full' })
    expect(await confirmAndClose(s)).toBe(false)
    h.savePdf.mockResolvedValueOnce({ refs: { new: '20R' } })
    expect(await confirmAndClose(s)).toBe(true)
    expect(h.askToSave).toHaveBeenCalledWith('a.pdf')
    expect(s.dirty).toBe(false)
  })

  it("Don't save closes without saving; Cancel keeps the tab", async () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    h.askToSave.mockResolvedValueOnce('discard')
    expect(await confirmAndClose(s)).toBe(true)
    h.askToSave.mockResolvedValueOnce('cancel')
    expect(await confirmAndClose(s)).toBe(false)
    expect(h.savePdf).not.toHaveBeenCalled()
  })
})

describe('close prompt', () => {
  it('activates the session before asking to save it', async () => {
    const a = fakeSession('C:\\a.pdf')
    const b = fakeSession('C:\\b.pdf')
    tabs.sessions = [a, b]
    tabs.activeId = a.id
    b.history.execute(addAnnotations([ink('x')]))
    let activeWhenAsked: string | null = null
    h.askToSave.mockImplementation(async () => {
      activeWhenAsked = tabs.activeId
      return 'cancel'
    })
    expect(await confirmCloseAll([a, b])).toBe(false)
    expect(activeWhenAsked).toBe(b.id)
  })
})

describe('confirmCloseAll', () => {
  it('prompts for each dirty session in turn and stops at Cancel', async () => {
    const a = fakeSession('C:\\a.pdf')
    const b = fakeSession('C:\\b.pdf')
    const c = fakeSession('C:\\c.pdf')
    const d = fakeSession('C:\\d.pdf')
    for (const s of [a, c, d]) s.history.execute(addAnnotations([ink('x')]))
    h.askToSave.mockResolvedValueOnce('discard').mockResolvedValueOnce('cancel')
    expect(await confirmCloseAll([a, b, c, d])).toBe(false)
    expect(h.askToSave.mock.calls).toEqual([['a.pdf'], ['c.pdf']])
  })

  it('returns true when every session may close', async () => {
    const a = fakeSession('C:\\a.pdf')
    a.history.execute(addAnnotations([ink('x')]))
    h.askToSave.mockResolvedValue('discard')
    expect(await confirmCloseAll([a, fakeSession('C:\\b.pdf')])).toBe(true)
  })
})

describe('pending edit (open text box)', () => {
  /** A pending edit that adds `id` when committed, as the text tool does. */
  function withPendingAdd(s: ReturnType<typeof fakeSession>, id: string) {
    const commit = vi.fn(() => s.history.execute(addAnnotations([ink(id)])))
    s.pendingEdit = commit
    return commit
  }

  it('saveSession commits the pending edit before writing it', async () => {
    const s = fakeSession()
    const commit = withPendingAdd(s, 'typed')
    h.savePdf.mockResolvedValue({ refs: { typed: '30R' } })
    expect(await saveSession(s)).toBe(true)
    expect(commit).toHaveBeenCalledOnce()
    expect(s.pendingEdit).toBeNull()
    expect(h.savePdf).toHaveBeenCalledWith(s.path, s.path, [ink('typed')], [])
    expect(s.dirty).toBe(false)
  })

  it('Ctrl+S (file.save) on a clean session with an open text box saves the box', async () => {
    const s = fakeSession()
    withPendingAdd(s, 'typed')
    h.savePdf.mockResolvedValue({ refs: { typed: '30R' } })
    const dispose = registerSaveCommands(() => s)
    try {
      await commands.execute('file.save')
    } finally {
      dispose()
    }
    expect(h.savePdf).toHaveBeenCalledOnce()
    expect(s.dirty).toBe(false)
  })

  it('confirmAndClose commits the pending edit before deciding whether to ask', async () => {
    const s = fakeSession()
    withPendingAdd(s, 'typed')
    h.askToSave.mockResolvedValueOnce('discard')
    expect(await confirmAndClose(s)).toBe(true)
    expect(h.askToSave).toHaveBeenCalledWith('a.pdf')
  })

  it('saveSessionAs commits before asking for the target', async () => {
    const s = fakeSession()
    const commit = withPendingAdd(s, 'typed')
    h.saveDialog.mockResolvedValue(null)
    expect(await saveSessionAs(s)).toBe(false)
    expect(commit).toHaveBeenCalledOnce()
  })
})

describe('saveSession with flattened annotations', () => {
  it('sends them flattened, then reloads: they are page content now', async () => {
    const s = fakeSession('C:\docs\a.pdf', [ink('a', '10R'), ink('keep', '11R')])
    s.history.execute(flattenAnnotations([s.store.get('a')!], 't'))
    s.reloaded = [ink('keep', '11R')]
    h.savePdf.mockResolvedValue({ refs: {} })
    expect(await saveSession(s)).toBe(true)
    const [, , upserts, deletes, pages] = h.savePdf.mock.calls[0]
    expect(upserts).toEqual([{ ...ink('a', '10R'), flattened: true, modifiedAt: 't' }])
    expect(deletes).toEqual([])
    expect(pages).toBeUndefined()
    expect(s.applyReload).toHaveBeenCalledOnce()
    expect(s.store.all().map((a) => a.id)).toEqual(['keep'])
    expect(s.dirty).toBe(false)
  })

  it('keeps an annotation flattened while saving flattened (and dirty) after the reload', async () => {
    const s = fakeSession('C:\docs\a.pdf', [ink('a', '10R'), ink('b', '11R')])
    s.history.execute(flattenAnnotations([s.store.get('a')!], 't'))
    s.reloaded = [ink('b', '31R')]
    const first = deferred<{ refs: Record<string, string> }>()
    h.savePdf.mockReturnValueOnce(first.promise)
    const saving = saveSession(s)
    s.history.execute(flattenAnnotations([s.store.get('b')!], 't'))
    first.resolve({ refs: {} })
    expect(await saving).toBe(true)
    expect(s.store.all().map((a) => [a.id, a.flattened])).toEqual([['b', true]])
    expect(s.dirty).toBe(true)
  })
})
