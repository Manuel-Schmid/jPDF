import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { isAppError, pathExists, savePdf } from '../core/ipc/api'
import { commands } from '../core/registry/commands'
import { keybindings } from '../core/registry/keybindings'
import { addAnnotations, compositeCommand, deleteAnnotations, updateAnnotation } from '../core/session/commands'
import type { Command } from '../core/session/history.svelte'
import type { Annotation } from '../core/session/model'
import type { DocumentSession } from '../core/session/session.svelte'
import { toasts } from '../ui/toasts.svelte'
import { askToSave } from './ConfirmClose.svelte'
import { tabs } from './tabs.svelte'

const DEFAULT_AUTHOR = 'JuliePDF'
const PDF_FILTER = [{ name: 'PDF', extensions: ['pdf'] }]

/** Saves of one session run one after another. */
const inFlight = new WeakMap<DocumentSession, Promise<unknown>>()

function withAuthor(a: Annotation): Annotation {
  return a.author ? a : { ...a, author: DEFAULT_AUTHOR }
}

function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function showSaveError(s: DocumentSession, e: unknown): void {
  if (isAppError(e) && (e.code === 'Locked' || e.code === 'ReadOnly')) {
    const why = e.code === 'Locked' ? 'is locked by another program' : 'is read-only'
    toasts.show(`Could not save: ${s.fileName} ${why}`, 'error', {
      label: 'Save As…',
      run: () => void saveSessionAs(s),
    })
    return
  }
  const detail = isAppError(e) ? e.message : e instanceof Error ? e.message : String(e)
  toasts.show(`Could not save ${s.fileName}: ${detail}`, 'error')
}

/** A session whose reload failed after a page save: saving it again would corrupt the file. */
function refuseBroken(s: DocumentSession): boolean {
  if (!s.broken) return false
  toasts.show(`${s.fileName} cannot be saved: it no longer matches the file. Close and reopen it.`, 'error')
  return true
}

async function writeSession(s: DocumentSession, target: string): Promise<boolean> {
  if (refuseBroken(s)) return false
  const { store, history } = s
  const present = new Set(store.all().map((a) => a.sourceRef).filter((r) => r !== null))
  const deletes = store.deletedRefs().filter((d) => !present.has(d.sourceRef))
  const upserts = store.changedSince().map(withAuthor)
  const orders = store.pageOrders()
  const before = new Map(store.all().map((a) => [a.id, a]))
  const savedState = history.stateId
  const pages = s.pages
  const planning = s.pagePlan()

  let refs: Record<string, string>
  let plan: Awaited<typeof planning> = null
  try {
    plan = planning && (await planning)
    ;({ refs } = await (plan || orders.length > 0
      ? savePdf(s.path, target, upserts, deletes, plan ?? undefined, orders)
      : savePdf(s.path, target, upserts, deletes)))
  } catch (e) {
    console.error(`Failed to save ${s.path} to ${target}`, e)
    showSaveError(s, e)
    return false
  }

  // Flattened annotations are now page content: pdf.js must draw the saved
  // pages, and the annotations leave the session, so reload as after a page change.
  if (plan || upserts.some((a) => a.flattened)) {
    if (!samePath(target, s.path)) s.setPath(target)
    await reloadSaved(s, before, pages)
    return true
  }

  // Edits made while the file was being written are not in it: keep them
  // pending. Deletions need nothing (the store keeps refs of removed ids).
  const changedDuring = store.all().filter((a) => before.get(a.id) !== a).map((a) => a.id)

  store.markSaved(
    refs,
    deletes.map((d) => d.sourceRef),
    orders,
  )
  // The pdf.js document still holds the old bytes; new refs are not in them,
  // but keep every ref this document has known suppressed.
  s.suppress(Object.values(refs))
  if (!samePath(target, s.path)) s.setPath(target)
  for (const id of changedDuring) store.update(id, store.get(id)!)
  // The file now matches the history position the save started from.
  history.markClean(savedState)
  return true
}

/**
 * After a save that changed pages: reloads the session from the saved file
 * (fresh history), trying twice. Annotation edits made since the save
 * started (`before`, `pages`: the state it wrote) are carried over as one
 * undoable step; after a page operation in that time they cannot be placed
 * and are dropped (with a warning). If the file cannot be reloaded the
 * session is marked broken: it no longer matches its file and must not save.
 */
async function reloadSaved(
  s: DocumentSession,
  before: Map<string, Annotation>,
  pages: DocumentSession['pages'],
): Promise<void> {
  const { store, history } = s
  let loaded: Awaited<ReturnType<DocumentSession['loadSaved']>>
  try {
    loaded = await s.loadSaved().catch((e: unknown) => {
      console.error(`Failed to reload ${s.path}, retrying`, e)
      return s.loadSaved()
    })
  } catch (e) {
    console.error(`Failed to reload ${s.path}`, e)
    s.broken = true
    toasts.show(`${s.fileName} was saved but could not be reloaded. Close and reopen it.`, 'error')
    return
  }
  // Right before switching: everything done while saving and loading counts.
  const changed = store.all().filter((a) => before.get(a.id) !== a)
  const removed = [...before.keys()].filter((id) => !store.get(id))
  const pagesChanged = s.pages !== pages
  s.applyReload(loaded)
  // A page operation since the save started is not in the file: the edits
  // made then cannot be placed on the reloaded pages (the page change itself
  // is gone too), so they are dropped, and the user is told.
  if (pagesChanged) {
    toasts.show('Changes made while saving were not kept', 'warning')
    return
  }
  if (changed.length === 0 && removed.length === 0) return
  const parts: Command[] = []
  const gone = removed.flatMap((id) => store.get(id) ?? [])
  if (gone.length) parts.push(deleteAnnotations(gone))
  for (const a of changed) {
    const saved = store.get(a.id)
    parts.push(saved ? updateAnnotation(saved, a) : addAnnotations([a]))
  }
  history.execute(compositeCommand('Edit annotation', parts))
}

/**
 * Commits a pending edit (see DocumentSession.commitPendingEdit), then
 * writes the session's annotation changes as an incremental update of its
 * current file to `targetPath` (default: the current file). On success the
 * session is clean and points at `targetPath`; returns false on error (an
 * error toast is shown and the session stays dirty).
 */
export function saveSession(s: DocumentSession, targetPath?: string): Promise<boolean> {
  // An open text box is part of what the user sees: save it too.
  s.commitPendingEdit()
  const prev = inFlight.get(s)
  const write = () => writeSession(s, targetPath ?? s.path)
  // Start right away when idle so the written state is the state at the call.
  const run = prev ? prev.then(write, write) : write()
  inFlight.set(s, run)
  run
    .finally(() => {
      if (inFlight.get(s) === run) inFlight.delete(s)
    })
    .catch(() => {})
  return run
}

/**
 * Asks for a target file and saves there; false if cancelled, refused or
 * failed. Refuses (error toast, nothing written) a file open in another tab,
 * and a typed name whose added ".pdf" names an existing file: the dialog only
 * confirmed replacing the name as typed.
 */
export async function saveSessionAs(s: DocumentSession): Promise<boolean> {
  s.commitPendingEdit()
  if (refuseBroken(s)) return false
  const picked = await saveDialog({ defaultPath: s.path, filters: PDF_FILTER })
  if (!picked) return false
  let target = picked
  if (!target.toLowerCase().endsWith('.pdf')) {
    target += '.pdf'
    if (await pathExists(target).catch(() => true)) {
      const name = target.split(/[\\/]/).pop()
      toasts.show(`Could not save: ${name} already exists. Choose it in the dialog to replace it.`, 'error')
      return false
    }
  }
  const other = tabs.findByPath(target)
  if (other && other.id !== s.id) {
    toasts.show('This file is open in another tab — close it first', 'error')
    return false
  }
  return saveSession(s, target)
}

/**
 * Asks Save / Don't save / Cancel for a dirty session. True if the session may
 * close (not dirty, saved, or discarded), false on Cancel or a failed save.
 */
export async function confirmAndClose(s: DocumentSession): Promise<boolean> {
  s.commitPendingEdit()
  // Broken: what was saved is on disk; what is shown can no longer be saved.
  if (!s.dirty || s.broken) return true
  // Show the document the question is about.
  if (tabs.sessions.some((x) => x.id === s.id)) tabs.activeId = s.id
  const choice = await askToSave(s.fileName)
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  // A save that succeeds may still leave edits made meanwhile unsaved.
  return (await saveSession(s)) && !s.dirty
}

/** confirmAndClose for each session in turn; stops at the first one that may not close. */
export async function confirmCloseAll(sessions: readonly DocumentSession[]): Promise<boolean> {
  for (const s of sessions) if (!(await confirmAndClose(s))) return false
  return true
}

/** Registers `file.save` (Ctrl+S) and `file.saveAs` (Ctrl+Shift+S). */
export function registerSaveCommands(active: () => DocumentSession | null): () => void {
  const enabled = () => active() !== null
  const disposers = [
    commands.register({
      id: 'file.save',
      title: 'Save',
      enabled,
      run: async () => {
        const s = active()
        s?.commitPendingEdit()
        if (s?.dirty) await saveSession(s)
      },
    }),
    keybindings.bind('Ctrl+S', 'file.save'),
    commands.register({
      id: 'file.saveAs',
      title: 'Save As…',
      enabled,
      run: async () => {
        const s = active()
        if (s) await saveSessionAs(s)
      },
    }),
    keybindings.bind('Ctrl+Shift+S', 'file.saveAs'),
  ]
  return () => disposers.forEach((d) => d())
}
