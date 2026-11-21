import type { DeletedRef, PageOrder } from '../session/store.svelte'
import { invoke } from '@tauri-apps/api/core'
import type { Annotation } from '../session/model'
import type { PageSpec } from '../session/pages'
import type { WindowState } from '../settings/settings.svelte'

export type AppErrorCode =
  | 'NotFound'
  | 'Locked'
  | 'ReadOnly'
  | 'Encrypted'
  | 'InvalidPdf'
  | 'Io'

export interface AppError {
  code: AppErrorCode
  message: string
}

const CODES: readonly string[] = ['NotFound', 'Locked', 'ReadOnly', 'Encrypted', 'InvalidPdf', 'Io']

export function isAppError(e: unknown): e is AppError {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  return typeof o.code === 'string' && CODES.includes(o.code) && typeof o.message === 'string'
}

export function openPdf(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('open_pdf', { path })
}

export function readAnnotations(path: string): Promise<Annotation[]> {
  return invoke<Annotation[]>('read_annotations', { path })
}

/**
 * Writes `upserts`/`deletes` as an incremental update of `sourcePath` to
 * `targetPath`; `refs` maps annotation id -> sourceRef. With `pages` the
 * saved document has exactly those pages in that order (annotation `page`
 * indexes the plan); without, the pages stay as they are. `orders` are the
 * z-orders to write into the `/Annots` of reordered pages (page indexes as
 * for annotations).
 */
export function savePdf(
  sourcePath: string,
  targetPath: string,
  upserts: Annotation[],
  deletes: DeletedRef[],
  pages?: PageSpec[],
  orders?: PageOrder[],
): Promise<{ refs: Record<string, string> }> {
  return invoke<{ refs: Record<string, string> }>('save_pdf', {
    sourcePath, targetPath, upserts, deletes, pages: pages ?? null, orders: orders ?? [],
  })
}

/**
 * Merges the PDFs at `paths`, in order, into a new file at `targetPath`
 * (written atomically). Errors name the file that could not be read.
 */
export function mergePdfs(paths: string[], targetPath: string): Promise<void> {
  return invoke<void>('merge_pdfs', { paths, targetPath })
}

/**
 * Writes a copy of `sourcePath` without annotations (links and form fields
 * stay) to `targetPath`. `flattened` (pending flattened annotations) are
 * burned into the pages first; with `pages` the copy has exactly those pages
 * and `flattened` index them, as in `savePdf`. The source is never changed.
 */
export function exportWithoutAnnotations(
  sourcePath: string,
  targetPath: string,
  flattened: Annotation[],
  pages?: PageSpec[],
): Promise<void> {
  return invoke<void>('export_without_annotations', { sourcePath, targetPath, flattened, pages: pages ?? null })
}

/** Whether a file exists at `path` (true when that cannot be determined). */
export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>('path_exists', { path })
}

export function getLaunchFiles(): Promise<string[]> {
  return invoke<string[]>('get_launch_files')
}

export function loadSettings(): Promise<unknown | null> {
  return invoke<unknown | null>('load_settings')
}

export function saveSettings(value: unknown): Promise<void> {
  return invoke<void>('save_settings', { value })
}

/**
 * How the window is left now, to save on close (while fullscreen: as it was
 * before fullscreen). Null when the backend cannot read it.
 */
export function getWindowState(): Promise<WindowState | null> {
  return invoke<WindowState | null>('window_state')
}

/** Size and modification time (ms since the epoch) of a file. */
export interface FileStamp {
  size: number
  modified: number
}

/** A crash recovery snapshot found on disk; `snapshot` is whatever was written. */
export interface RecoveredSnapshot {
  id: string
  snapshot: unknown
}

/** The file's size and modification time; null when it is missing or unreadable. */
export function fileStamp(path: string): Promise<FileStamp | null> {
  return invoke<FileStamp | null>('file_stamp', { path })
}

/**
 * Writes tab `id`'s recovery snapshot (atomically), after writing `images`
 * (key -> base64 PNG) next to it. Images written earlier are kept.
 */
export function writeRecovery(id: string, snapshot: unknown, images: Record<string, string>): Promise<void> {
  return invoke<void>('write_recovery', { id, snapshot, images })
}

export function listRecovery(): Promise<RecoveredSnapshot[]> {
  return invoke<RecoveredSnapshot[]>('list_recovery')
}

/** An image written with `writeRecovery` (base64 PNG); null when missing. */
export function readRecoveryImage(id: string, key: string): Promise<string | null> {
  return invoke<string | null>('read_recovery_image', { id, key })
}

/** Removes tab `id`'s snapshot and images (nothing to remove is fine). */
export function deleteRecovery(id: string): Promise<void> {
  return invoke<void>('delete_recovery', { id })
}
