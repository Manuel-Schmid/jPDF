import {
  deleteRecovery, fileStamp, listRecovery, readRecoveryImage, writeRecovery, type FileStamp, type RecoveredSnapshot,
} from '../core/ipc/api'
import { addAnnotations, compositeCommand, deleteAnnotations, updateAnnotation } from '../core/session/commands'
import type { Command } from '../core/session/history.svelte'
import type { Annotation } from '../core/session/model'
import { isIdentity } from '../core/session/pages'
import type { DocumentSession } from '../core/session/session.svelte'
import type { DeletedRef, PageOrder } from '../core/session/store.svelte'
import { toasts } from '../ui/toasts.svelte'
import { askToRestore } from './RestorePrompt.svelte'

/**
 * Crash recovery: while a tab is dirty, its unsaved annotation changes are
 * written to a recovery folder (see src-tauri/src/commands/recovery.rs),
 * never into the PDF; on the next start leftover snapshots are offered back.
 */

/** A snapshot is written this long after the first change it contains. */
export const SNAPSHOT_DELAY_MS = 30_000
/** While a pointer is down (mid-stroke, mid-drag) the write waits this long and tries again. */
const BUSY_RETRY_MS = 1_000

/**
 * The changes of one tab against its file, as written to `snapshot.json`.
 * Image annotations are written with an empty `png`; `images` maps their id
 * to the key of the image file written next to the snapshot.
 */
export interface RecoverySnapshot {
  version: 1
  path: string
  /** When the snapshot was written (ISO). */
  savedAt: string
  /** The file the changes apply to, when it was last loaded or saved (null: unknown). */
  file: FileStamp | null
  /**
   * Unsaved page operations: annotation pages then index the shown pages,
   * not the file's, so nothing in the snapshot can be restored.
   */
  pagesChanged: boolean
  upserts: Annotation[]
  deletes: DeletedRef[]
  orders: PageOrder[]
  images: Record<string, string>
}

/** The parts of a DocumentSession recovery uses. */
export type RecoverableSession = Pick<DocumentSession, 'id' | 'path' | 'store' | 'history' | 'dirty' | 'broken' | 'pages'> & {
  doc: { numPages: number }
}

/** Image already written for a session: its PNG (same string = same image) and file key. */
interface WrittenImage { png: string; key: string }

/**
 * The snapshot of `s` and the images it needs that are not in `written` yet
 * (key -> base64). `written` is not changed; `newKey` names new image files.
 */
export function buildSnapshot(
  s: RecoverableSession,
  file: FileStamp | null,
  written: ReadonlyMap<string, WrittenImage>,
  newKey: () => string = () => crypto.randomUUID(),
  now = new Date(),
): { snapshot: RecoverySnapshot; newImages: Map<string, WrittenImage> } {
  const base = { version: 1 as const, path: s.path, savedAt: now.toISOString(), file }
  const newImages = new Map<string, WrittenImage>()
  if (!isIdentity(s.pages, s.doc.numPages)) {
    return { snapshot: { ...base, pagesChanged: true, upserts: [], deletes: [], orders: [], images: {} }, newImages }
  }
  const images: Record<string, string> = {}
  const upserts = s.store.changedSince().map((a) => {
    if (a.kind !== 'image') return a
    const known = written.get(a.id)
    // Strings are compared by identity first: an unchanged image costs nothing.
    const entry = known && known.png === a.image.png ? known : { png: a.image.png, key: newKey() }
    if (entry !== known) newImages.set(a.id, entry)
    images[a.id] = entry.key
    return { ...a, image: { ...a.image, png: '' } }
  })
  const snapshot: RecoverySnapshot = {
    ...base,
    pagesChanged: false,
    upserts,
    deletes: s.store.deletedRefs(),
    orders: s.store.pageOrders(),
    images,
  }
  return { snapshot, newImages }
}

export interface RecoveryIpc {
  fileStamp: typeof fileStamp
  writeRecovery: typeof writeRecovery
  deleteRecovery: typeof deleteRecovery
}

interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

interface Tracked {
  session: RecoverableSession
  timer: unknown
  /** Stamp of the file as last loaded or saved; undefined until first needed. */
  file: FileStamp | null | undefined
  images: Map<string, WrittenImage>
  /** Whether a snapshot may be on disk. */
  onDisk: boolean
  /** A save in flight: snapshots wait for it (its changes and stamp would not match). */
  saving: Promise<unknown> | null
  /** Writes and deletes of this session, one after another. */
  queue: Promise<void>
}

/**
 * Keeps each open tab's recovery snapshot up to date: schedules a write
 * SNAPSHOT_DELAY_MS after a change (later changes ride along), deletes the
 * snapshot once the tab is clean or closed. Writes happen off the drawing
 * path: never while a pointer is down, and only the changed annotations.
 */
export class RecoveryWriter {
  private tracked = new Map<string, Tracked>()

  constructor(
    private ipc: RecoveryIpc = { fileStamp, writeRecovery, deleteRecovery },
    /** Whether a gesture is in progress (see trackPointerDown); writes wait for it to end. */
    public busy: () => boolean = () => false,
    private timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as number) },
  ) {}

  /** The history (or page list) of `s` changed: write or delete its snapshot soon. */
  changed(s: RecoverableSession): void {
    const t = this.track(s)
    if (t.timer !== null) return
    // Clean and nothing on disk: nothing to do.
    if (!s.dirty && !t.onDisk) return
    t.timer = this.timers.set(() => this.fire(t), SNAPSHOT_DELAY_MS)
  }

  /**
   * A save of `s` started: snapshots wait for it; afterwards the file's stamp
   * is read again and the snapshot brought up to date right away.
   */
  saving(s: RecoverableSession, run: Promise<unknown>): void {
    const t = this.track(s)
    t.saving = run
    const done = () => {
      if (t.saving !== run) return
      t.saving = null
      t.file = undefined
      void this.flush(s)
    }
    run.then(done, done)
  }

  /** Writes (or deletes, when clean) the snapshot of `s` now. */
  flush(s: RecoverableSession): Promise<void> {
    const t = this.track(s)
    if (t.timer !== null) this.timers.clear(t.timer)
    t.timer = null
    return this.enqueue(t, () => this.write(t))
  }

  /** `s` was closed (saved or discarded): delete its snapshot. */
  forget(s: RecoverableSession): Promise<void> {
    const t = this.tracked.get(s.id)
    if (!t) return Promise.resolve()
    if (t.timer !== null) this.timers.clear(t.timer)
    this.tracked.delete(s.id)
    return this.enqueue(t, () => this.remove(t))
  }

  /** Every tab closed (window close after Save / Don't save): delete all snapshots. */
  async forgetAll(): Promise<void> {
    await Promise.all([...this.tracked.values()].map((t) => this.forget(t.session)))
  }

  /**
   * Follows `sessions()` reactively: history and page changes schedule
   * snapshots, tabs that leave the list are forgotten. Returns a stop function.
   */
  watch(sessions: () => readonly RecoverableSession[]): () => void {
    const seen = new Map<string, unknown>()
    return $effect.root(() => {
      $effect(() => {
        const list = sessions()
        const ids = new Set<string>()
        for (const s of list) {
          ids.add(s.id)
          // Reading both subscribes to them; pages is replaced on every page operation.
          const key = `${s.history.version}`
          const pages = s.pages
          const prev = seen.get(s.id) as { key: string; pages: unknown } | undefined
          seen.set(s.id, { key, pages })
          if (prev && (prev.key !== key || prev.pages !== pages)) this.changed(s)
          else if (!prev && s.dirty) this.changed(s)
        }
        for (const id of [...seen.keys()]) {
          if (ids.has(id)) continue
          seen.delete(id)
          const t = this.tracked.get(id)
          if (t) void this.forget(t.session)
        }
      })
    })
  }

  private track(s: RecoverableSession): Tracked {
    let t = this.tracked.get(s.id)
    if (!t) {
      t = { session: s, timer: null, file: undefined, images: new Map(), onDisk: false, saving: null, queue: Promise.resolve() }
      this.tracked.set(s.id, t)
    }
    return t
  }

  private fire(t: Tracked): void {
    t.timer = null
    if (this.tracked.get(t.session.id) !== t) return
    // Mid-stroke or mid-drag: try again shortly (the gesture's change is coming).
    if (this.busy()) {
      t.timer = this.timers.set(() => this.fire(t), BUSY_RETRY_MS)
      return
    }
    void this.enqueue(t, () => this.write(t))
  }

  private enqueue(t: Tracked, job: () => Promise<void>): Promise<void> {
    const run = t.queue.then(job).catch((e: unknown) => console.error(`Recovery snapshot of ${t.session.path} failed`, e))
    t.queue = run
    return run
  }

  private async write(t: Tracked): Promise<void> {
    if (t.saving) await t.saving.catch(() => {})
    if (this.tracked.get(t.session.id) !== t) return
    const s = t.session
    // Broken: the session no longer matches its file; its changes cannot be applied to it.
    if (!s.dirty || s.broken) return this.remove(t)
    if (t.file === undefined) t.file = await this.ipc.fileStamp(s.path).catch(() => null)
    const { snapshot, newImages } = buildSnapshot(s, t.file, t.images)
    const images: Record<string, string> = {}
    for (const { png, key } of newImages.values()) images[key] = png
    t.onDisk = true
    await this.ipc.writeRecovery(s.id, snapshot, images)
    for (const [id, entry] of newImages) t.images.set(id, entry)
  }

  private async remove(t: Tracked): Promise<void> {
    if (!t.onDisk) return
    await this.ipc.deleteRecovery(t.session.id)
    t.onDisk = false
    t.images.clear()
  }
}

/** Whether a pointer button is held anywhere in the window (a stroke or drag in progress). */
export function trackPointerDown(target: Window): { down: () => boolean; dispose: () => void } {
  const held = new Set<number>()
  const press = (e: PointerEvent) => held.add(e.pointerId)
  const release = (e: PointerEvent) => held.delete(e.pointerId)
  const opts = { capture: true, passive: true }
  target.addEventListener('pointerdown', press, opts)
  target.addEventListener('pointerup', release, opts)
  target.addEventListener('pointercancel', release, opts)
  // A release outside the window is never seen: losing focus ends the gesture.
  const clear = () => held.clear()
  target.addEventListener('blur', clear)
  return {
    down: () => held.size > 0,
    dispose: () => {
      target.removeEventListener('pointerdown', press, opts)
      target.removeEventListener('pointerup', release, opts)
      target.removeEventListener('pointercancel', release, opts)
      target.removeEventListener('blur', clear)
    },
  }
}

export const recovery = new RecoveryWriter()

/** A snapshot as read back, or null when it is not one this version can use. */
export function parseSnapshot(value: unknown): RecoverySnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<RecoverySnapshot>
  const ok =
    v.version === 1 &&
    typeof v.path === 'string' &&
    typeof v.pagesChanged === 'boolean' &&
    Array.isArray(v.upserts) &&
    Array.isArray(v.deletes) &&
    Array.isArray(v.orders) &&
    typeof v.images === 'object' &&
    v.images !== null
  return ok ? (v as RecoverySnapshot) : null
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  return a !== null && b !== null && a.size === b.size && a.modified === b.modified
}

/**
 * The snapshot's changes as one undo step on `s` (null when there is
 * nothing to apply). `exact`: the file is unchanged since the snapshot, so
 * annotations are matched by their file object (their ids may be new on
 * every load) and page z-orders are restored; otherwise they are matched by
 * id only (a saved `/NM`) and z-orders are skipped. Annotations on pages the
 * file no longer has are dropped.
 */
export function recoveryCommand(s: RecoverableSession, snap: RecoverySnapshot, exact: boolean): Command | null {
  const { store } = s
  const byRef = new Map<string, string>()
  if (exact) for (const a of store.all()) if (a.sourceRef) byRef.set(a.sourceRef, a.id)
  const idOf = (id: string, ref: string | null) => (ref && byRef.get(ref)) || id
  const pageCount = s.pages.length
  const parts: Command[] = []

  const gone = snap.deletes.flatMap((d) => store.get(idOf(d.id, d.sourceRef)) ?? [])
  if (gone.length) parts.push(deleteAnnotations(gone))

  const added: Annotation[] = []
  for (const a of snap.upserts) {
    if (a.page < 0 || a.page >= pageCount) continue
    const next = { ...a, id: idOf(a.id, a.sourceRef) }
    const current = store.get(next.id)
    if (current) parts.push(updateAnnotation(current, next))
    else added.push(next)
  }
  if (added.length) parts.push(addAnnotations(added))

  if (exact) {
    for (const o of snap.orders) {
      const after = o.annotations.map((x) => idOf(x.id, x.sourceRef))
      let before: string[] = []
      parts.push({
        label: 'Reorder',
        do: (st) => {
          before = st.byPage(o.page).map((a) => a.id)
          const same = before.length === after.length && after.every((id) => before.includes(id))
          if (same) st.reorder(o.page, after)
        },
        undo: (st) => {
          const now = st.byPage(o.page).map((a) => a.id)
          if (now.length === before.length && before.every((id) => now.includes(id))) st.reorder(o.page, before)
        },
      })
    }
  }
  return parts.length ? compositeCommand('Restore unsaved changes', parts) : null
}

/** Puts the images (stored next to the snapshot) back into its image annotations; drops those whose image is lost. */
async function withImages(
  id: string,
  snap: RecoverySnapshot,
  read: typeof readRecoveryImage,
): Promise<RecoverySnapshot> {
  const upserts = await Promise.all(
    snap.upserts.map(async (a): Promise<Annotation | null> => {
      if (a.kind !== 'image') return a
      const key = snap.images[a.id]
      const png = key ? await read(id, key).catch(() => null) : null
      return png ? { ...a, image: { ...a.image, png } } : null
    }),
  )
  return { ...snap, upserts: upserts.filter((a) => a !== null) }
}

export interface RestoreDeps {
  list: typeof listRecovery
  stamp: typeof fileStamp
  readImage: typeof readRecoveryImage
  remove: typeof deleteRecovery
  ask: typeof askToRestore
  /** Opens the file in a tab (or finds its open tab). */
  open: (path: string) => Promise<RecoverableSession>
  /** Writes the restored tab's own snapshot at once (before the old one is deleted). */
  flush: (s: RecoverableSession) => Promise<void>
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * At start: offers each leftover snapshot back, one after another. Restore
 * opens the file and applies the changes as an unsaved undo step; Discard
 * deletes the snapshot; Later (Escape) keeps it for the next start.
 */
export async function restoreRecovered(deps: RestoreDeps): Promise<void> {
  let found: RecoveredSnapshot[]
  try {
    found = await deps.list()
  } catch (e) {
    console.error('Could not read crash recovery snapshots', e)
    return
  }
  for (const { id, snapshot } of found) {
    try {
      await restoreOne(id, snapshot, deps)
    } catch (e) {
      console.error(`Could not restore recovery snapshot ${id}`, e)
      toasts.show('Unsaved changes from the last session could not be restored', 'error')
    }
  }
}

async function restoreOne(id: string, value: unknown, deps: RestoreDeps): Promise<void> {
  const snap = parseSnapshot(value)
  if (!snap) {
    await deps.remove(id)
    return
  }
  const name = fileNameOf(snap.path)
  const now = await deps.stamp(snap.path).catch(() => null)
  if (now === null) {
    toasts.show(`Unsaved changes to ${name} could not be restored: the file was not found`, 'warning')
    await deps.remove(id)
    return
  }
  if (snap.pagesChanged) {
    toasts.show(`Unsaved changes to ${name} could not be restored: they included page changes`, 'warning')
    await deps.remove(id)
    return
  }
  if (snap.upserts.length === 0 && snap.deletes.length === 0 && snap.orders.length === 0) {
    await deps.remove(id)
    return
  }
  const exact = sameStamp(snap.file, now)
  const choice = await deps.ask(name, !exact)
  if (choice === 'later') return
  if (choice === 'discard') {
    await deps.remove(id)
    return
  }
  const full = await withImages(id, snap, deps.readImage)
  const s = await deps.open(snap.path)
  const cmd = recoveryCommand(s, full, exact)
  if (cmd) {
    s.history.execute(cmd)
    await deps.flush(s)
  }
  await deps.remove(id)
}
