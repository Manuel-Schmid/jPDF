import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import {
  buildSnapshot, parseSnapshot, recoveryCommand, RecoveryWriter, restoreRecovered, SNAPSHOT_DELAY_MS,
  type RecoverableSession, type RecoveryIpc, type RestoreDeps, type RecoverySnapshot,
} from '../../src/app/recovery.svelte'
import { addAnnotations, deleteAnnotations, reorderAnnotations, updateAnnotation } from '../../src/core/session/commands'
import { History } from '../../src/core/session/history.svelte'
import type { ImageAnnotation, InkAnnotation } from '../../src/core/session/model'
import { identityPages, type PageEntry } from '../../src/core/session/pages'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import { toasts } from '../../src/ui/toasts.svelte'
import { TabsStore } from '../../src/app/tabs.svelte'
import type { DocumentSession } from '../../src/core/session/session.svelte'

function ink(id: string, sourceRef: string | null = null, page = 0): InkAnnotation {
  return {
    kind: 'ink', id, page, sourceRef, modifiedAt: '2026-11-18T10:00:00Z', author: 'JuliePDF',
    strokes: [[[0, 0], [10, 10]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
  }
}

function image(id: string, png = 'iVBORw0KGgo='): ImageAnnotation {
  return {
    kind: 'image', id, page: 0, sourceRef: null, modifiedAt: '2026-11-18T10:00:00Z', author: 'JuliePDF',
    rect: [0, 0, 10, 10], image: { width: 1, height: 1, png },
  }
}

let count = 0

function fakeSession(loaded: InkAnnotation[] = [], path = 'C:\\docs\\a.pdf', numPages = 3) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const s = {
    id: `00000000-0000-0000-0000-${String(++count).padStart(12, '0')}`,
    path,
    store,
    history,
    get dirty() {
      return history.isDirty
    },
    broken: false,
    pages: identityPages(numPages) as PageEntry[],
    doc: { numPages },
  }
  return s as typeof s & RecoverableSession
}

const STAMP = { size: 100, modified: 1_700_000_000_000 }

/** Timers run by hand: `run()` fires every pending timer once. */
function manualTimers() {
  let next = 1
  const pending = new Map<number, { fn: () => void; ms: number }>()
  return {
    pending,
    set: (fn: () => void, ms: number) => {
      const h = next++
      pending.set(h, { fn, ms })
      return h
    },
    clear: (h: unknown) => void pending.delete(h as number),
    run() {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, t] of due) t.fn()
    },
  }
}

function fakeIpc() {
  return {
    fileStamp: vi.fn(async () => STAMP),
    writeRecovery: vi.fn(async () => {}),
    deleteRecovery: vi.fn(async () => {}),
  } satisfies RecoveryIpc
}

/** Lets queued promise chains (IPC mocks resolve at once) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const t of [...toasts.items]) toasts.dismiss(t.id)
  vi.restoreAllMocks()
})

describe('buildSnapshot', () => {
  it('holds the changes against the file: upserts, deletes and page orders', () => {
    const s = fakeSession([ink('a', '10R'), ink('b', '11R'), ink('c', '12R')])
    s.history.execute(deleteAnnotations([s.store.get('a')!]))
    s.history.execute(addAnnotations([ink('new')]))
    s.history.execute(reorderAnnotations([s.store.get('b')!], 'front'))
    const { snapshot } = buildSnapshot(s, STAMP, new Map(), undefined, new Date('2026-11-21T10:00:00Z'))
    expect(snapshot).toEqual({
      version: 1,
      path: 'C:\\docs\\a.pdf',
      savedAt: '2026-11-21T10:00:00.000Z',
      file: STAMP,
      pagesChanged: false,
      upserts: [ink('new')],
      deletes: [{ id: 'a', sourceRef: '10R' }],
      orders: [{ page: 0, annotations: [{ id: 'c', sourceRef: '12R' }, { id: 'new', sourceRef: null }, { id: 'b', sourceRef: '11R' }] }],
      images: {},
    })
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('writes each image once: later snapshots only refer to it', () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([image('img')]))
    const first = buildSnapshot(s, STAMP, new Map(), () => 'key-1')
    expect(first.snapshot.upserts).toEqual([{ ...image('img'), image: { width: 1, height: 1, png: '' } }])
    expect(first.snapshot.images).toEqual({ img: 'key-1' })
    expect([...first.newImages]).toEqual([['img', { png: 'iVBORw0KGgo=', key: 'key-1' }]])

    // Moved: same image, nothing new to write.
    const moved = { ...s.store.get('img')!, rect: [5, 5, 15, 15] } as ImageAnnotation
    s.history.execute(updateAnnotation(s.store.get('img')!, moved))
    const second = buildSnapshot(s, STAMP, first.newImages, () => 'key-2')
    expect(second.newImages.size).toBe(0)
    expect(second.snapshot.images).toEqual({ img: 'key-1' })
  })

  it('records unsaved page operations instead of changes that no longer fit the file', () => {
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('new')]))
    s.pages = identityPages(2)
    const { snapshot } = buildSnapshot(s, STAMP, new Map())
    expect(snapshot).toMatchObject({ pagesChanged: true, upserts: [], deletes: [], orders: [] })
  })

  it('parseSnapshot rejects other shapes and versions', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ version: 2, path: 'a' })).toBeNull()
    expect(parseSnapshot({ version: 1, path: 'a', pagesChanged: false, upserts: [], deletes: [] })).toBeNull()
  })
})

describe('RecoveryWriter', () => {
  it('writes once, SNAPSHOT_DELAY_MS after the first change; later changes ride along', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    const w = new RecoveryWriter(ipc, () => false, timers)
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    w.changed(s)
    s.history.execute(addAnnotations([ink('b')]))
    w.changed(s)
    expect(timers.pending.size).toBe(1)
    expect([...timers.pending.values()][0].ms).toBe(SNAPSHOT_DELAY_MS)
    expect(ipc.writeRecovery).not.toHaveBeenCalled()
    timers.run()
    await settle()
    expect(ipc.fileStamp).toHaveBeenCalledWith('C:\\docs\\a.pdf')
    expect(ipc.writeRecovery).toHaveBeenCalledTimes(1)
    const [id, snap, images] = ipc.writeRecovery.mock.calls[0] as unknown as [string, RecoverySnapshot, object]
    expect(id).toBe(s.id)
    expect(snap.upserts.map((a) => a.id)).toEqual(['a', 'b'])
    expect(snap.file).toEqual(STAMP)
    expect(images).toEqual({})
  })

  it('waits while a pointer is down', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    let down = true
    const w = new RecoveryWriter(ipc, () => down, timers)
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    w.changed(s)
    timers.run()
    await settle()
    expect(ipc.writeRecovery).not.toHaveBeenCalled()
    expect(timers.pending.size).toBe(1)
    down = false
    timers.run()
    await settle()
    expect(ipc.writeRecovery).toHaveBeenCalledTimes(1)
  })

  it('sends each image only with the first snapshot that has it', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    const w = new RecoveryWriter(ipc, () => false, timers)
    const s = fakeSession()
    s.history.execute(addAnnotations([image('img')]))
    await w.flush(s)
    s.history.execute(addAnnotations([ink('a')]))
    await w.flush(s)
    const sent = ipc.writeRecovery.mock.calls.map((c) => Object.values((c as unknown[])[2] as object))
    expect(sent).toEqual([['iVBORw0KGgo='], []])
  })

  it('deletes the snapshot once the tab is clean again, and when it is forgotten', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    const w = new RecoveryWriter(ipc, () => false, timers)
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    await w.flush(s)
    s.history.undo()
    w.changed(s)
    timers.run()
    await settle()
    expect(ipc.deleteRecovery).toHaveBeenCalledWith(s.id)

    // Clean with nothing on disk: nothing is scheduled.
    w.changed(s)
    expect(timers.pending.size).toBe(0)

    s.history.redo()
    await w.flush(s)
    await w.forget(s)
    expect(ipc.deleteRecovery).toHaveBeenCalledTimes(2)
    // Forgotten without a snapshot on disk: nothing to delete.
    await w.forget(fakeSession())
    expect(ipc.deleteRecovery).toHaveBeenCalledTimes(2)
  })

  it('waits for a save, then reads the file stamp again and updates the snapshot', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    const w = new RecoveryWriter(ipc, () => false, timers)
    const s = fakeSession()
    s.history.execute(addAnnotations([ink('a')]))
    await w.flush(s)
    expect(ipc.fileStamp).toHaveBeenCalledTimes(1)

    let finish!: (ok: boolean) => void
    const run = new Promise<boolean>((r) => (finish = r))
    w.saving(s, run)
    s.history.execute(addAnnotations([ink('b')]))
    const pending = w.flush(s)
    await settle()
    expect(ipc.writeRecovery).toHaveBeenCalledTimes(1)
    // The save writes everything up to here; the session is clean afterwards.
    s.history.markClean()
    ipc.fileStamp.mockResolvedValue({ size: 120, modified: 2 })
    finish(true)
    await pending
    await settle()
    expect(ipc.writeRecovery).toHaveBeenCalledTimes(1)
    expect(ipc.deleteRecovery).toHaveBeenCalledWith(s.id)

    s.history.execute(addAnnotations([ink('c')]))
    await w.flush(s)
    expect(ipc.fileStamp).toHaveBeenCalledTimes(2)
    expect((ipc.writeRecovery.mock.calls[1] as unknown[])[1]).toMatchObject({ file: { size: 120, modified: 2 } })
  })

  it('forgetAll deletes every snapshot (window closed after Save / Don\'t save)', async () => {
    const ipc = fakeIpc()
    const w = new RecoveryWriter(ipc, () => false, manualTimers())
    const a = fakeSession()
    const b = fakeSession()
    for (const s of [a, b]) {
      s.history.execute(addAnnotations([ink('x')]))
      await w.flush(s)
    }
    await w.forgetAll()
    expect(ipc.deleteRecovery.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual([a.id, b.id].sort())
  })

  it('watch schedules on history changes and forgets tabs that leave the list', async () => {
    const ipc = fakeIpc()
    const timers = manualTimers()
    const w = new RecoveryWriter(ipc, () => false, timers)
    const s = fakeSession()
    // A reactive tab list (TabsStore.sessions is $state).
    const tabs = new TabsStore()
    tabs.sessions = [s as unknown as DocumentSession]
    const stop = w.watch(() => tabs.sessions as unknown as RecoverableSession[])
    flushSync()
    expect(timers.pending.size).toBe(0)
    s.history.execute(addAnnotations([ink('a')]))
    flushSync()
    expect(timers.pending.size).toBe(1)
    timers.run()
    await settle()
    expect(ipc.writeRecovery).toHaveBeenCalledTimes(1)
    tabs.sessions = []
    flushSync()
    await settle()
    expect(ipc.deleteRecovery).toHaveBeenCalledWith(s.id)
    stop()
  })
})

function snapshotOf(over: Partial<RecoverySnapshot>): RecoverySnapshot {
  return {
    version: 1, path: 'C:\\docs\\a.pdf', savedAt: '2026-11-21T10:00:00Z', file: STAMP, pagesChanged: false,
    upserts: [], deletes: [], orders: [], images: {}, ...over,
  }
}

describe('recoveryCommand', () => {
  it('matches file annotations by their object when the file is unchanged (ids are new on each load)', () => {
    const s = fakeSession([ink('fresh-1', '10R'), ink('fresh-2', '11R'), ink('fresh-3', '12R')])
    const snap = snapshotOf({
      upserts: [{ ...ink('old-1', '10R'), color: [0, 0, 1] }, ink('new')],
      deletes: [{ id: 'old-2', sourceRef: '11R' }],
      orders: [{ page: 0, annotations: [{ id: 'new', sourceRef: null }, { id: 'old-1', sourceRef: '10R' }, { id: 'old-3', sourceRef: '12R' }] }],
    })
    s.history.execute(recoveryCommand(s, snap, true)!)
    expect(s.dirty).toBe(true)
    expect(s.store.byPage(0).map((a) => a.id)).toEqual(['new', 'fresh-1', 'fresh-3'])
    expect((s.store.get('fresh-1') as InkAnnotation).color).toEqual([0, 0, 1])
    expect(s.store.deletedRefs()).toEqual([{ id: 'fresh-2', sourceRef: '11R' }])
    s.history.undo()
    expect(s.dirty).toBe(false)
    expect(s.store.byPage(0).map((a) => a.id)).toEqual(['fresh-1', 'fresh-2', 'fresh-3'])
  })

  it('matches by id only when the file changed, and skips z-orders', () => {
    const s = fakeSession([ink('nm-1', '20R'), ink('other', '10R')])
    const snap = snapshotOf({
      upserts: [{ ...ink('nm-1', '10R'), width: 5 }, { ...ink('gone', '11R') }],
      deletes: [{ id: 'nm-x', sourceRef: '10R' }],
      orders: [{ page: 0, annotations: [{ id: 'other', sourceRef: '10R' }, { id: 'nm-1', sourceRef: '10R' }] }],
    })
    s.history.execute(recoveryCommand(s, snap, false)!)
    expect((s.store.get('nm-1') as InkAnnotation).width).toBe(5)
    expect((s.store.get('other') as InkAnnotation).width).toBe(2)
    // Not in the file any more: restored as a new annotation.
    expect(s.store.get('gone')!.sourceRef).toBeNull()
    expect(s.store.deletedRefs()).toEqual([])
  })

  it('drops annotations on pages the file does not have; nothing left is null', () => {
    const s = fakeSession([], 'C:\\docs\\a.pdf', 2)
    expect(recoveryCommand(s, snapshotOf({ upserts: [ink('far', null, 5)] }), true)).toBeNull()
  })
})

describe('restoreRecovered', () => {
  function deps(over: Partial<RestoreDeps> = {}) {
    const session = fakeSession([ink('fresh', '10R')])
    const d = {
      list: vi.fn(async () => [{ id: 'snap-1', snapshot: snapshotOf({ upserts: [ink('new')] }) }]),
      stamp: vi.fn(async () => STAMP),
      readImage: vi.fn(async () => 'cG5n'),
      remove: vi.fn(async () => {}),
      ask: vi.fn(async () => 'restore' as const),
      open: vi.fn(async () => session),
      flush: vi.fn(async () => {}),
      ...over,
    }
    return { d, session }
  }

  it('Restore opens the file, applies the changes unsaved, writes the new snapshot, then deletes the old one', async () => {
    const { d, session } = deps()
    await restoreRecovered(d)
    expect(d.ask).toHaveBeenCalledWith('a.pdf', false)
    expect(d.open).toHaveBeenCalledWith('C:\\docs\\a.pdf')
    expect(session.store.get('new')).toBeTruthy()
    expect(session.dirty).toBe(true)
    expect(d.flush).toHaveBeenCalledWith(session)
    expect(d.remove).toHaveBeenCalledWith('snap-1')
    expect(d.flush.mock.invocationCallOrder[0]).toBeLessThan(d.remove.mock.invocationCallOrder[0])
  })

  it('says when the file changed since', async () => {
    const { d } = deps({ stamp: vi.fn(async () => ({ size: 1, modified: 2 })) })
    await restoreRecovered(d)
    expect(d.ask).toHaveBeenCalledWith('a.pdf', true)
  })

  it('Discard deletes the snapshot; Later keeps it', async () => {
    const discard = deps({ ask: vi.fn(async () => 'discard' as const) })
    await restoreRecovered(discard.d)
    expect(discard.d.remove).toHaveBeenCalledWith('snap-1')
    expect(discard.d.open).not.toHaveBeenCalled()

    const later = deps({ ask: vi.fn(async () => 'later' as const) })
    await restoreRecovered(later.d)
    expect(later.d.remove).not.toHaveBeenCalled()
    expect(later.d.open).not.toHaveBeenCalled()
  })

  it('puts images back; an image whose file is lost is dropped', async () => {
    const snapshot = snapshotOf({
      upserts: [{ ...image('img'), image: { width: 1, height: 1, png: '' } }, { ...image('lost'), image: { width: 1, height: 1, png: '' } }],
      images: { img: 'k1', lost: 'k2' },
    })
    const { d, session } = deps({
      list: vi.fn(async () => [{ id: 'snap-1', snapshot }]),
      readImage: vi.fn(async (_id: string, key: string) => (key === 'k1' ? 'cG5n' : null)),
    })
    await restoreRecovered(d)
    expect((session.store.get('img') as ImageAnnotation).image.png).toBe('cG5n')
    expect(session.store.get('lost')).toBeUndefined()
  })

  it('reports a missing file or unsaved page changes and deletes the snapshot without asking', async () => {
    const missing = deps({ stamp: vi.fn(async () => null) })
    await restoreRecovered(missing.d)
    expect(missing.d.ask).not.toHaveBeenCalled()
    expect(missing.d.remove).toHaveBeenCalledWith('snap-1')
    expect(toasts.items.at(-1)?.message).toContain('a.pdf could not be restored: the file was not found')

    const pages = deps({ list: vi.fn(async () => [{ id: 'snap-1', snapshot: snapshotOf({ pagesChanged: true }) }]) })
    await restoreRecovered(pages.d)
    expect(pages.d.ask).not.toHaveBeenCalled()
    expect(pages.d.remove).toHaveBeenCalledWith('snap-1')
    expect(toasts.items.at(-1)?.message).toContain('page changes')
  })

  it('deletes unreadable snapshots and goes on with the next', async () => {
    const { d, session } = deps({
      list: vi.fn(async () => [
        { id: 'bad', snapshot: { version: 99 } },
        { id: 'good', snapshot: snapshotOf({ upserts: [ink('new')] }) },
      ]),
    })
    await restoreRecovered(d)
    expect(d.remove.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['bad', 'good'])
    expect(session.store.get('new')).toBeTruthy()
  })
})
