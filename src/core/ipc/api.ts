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
