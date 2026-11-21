import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getLaunchFiles, isAppError } from '../core/ipc/api'
import { fileNameOf } from '../core/session/session.svelte'
import { toasts } from '../ui/toasts.svelte'
import { openErrorMessage } from './openErrors'

type OpenHandler = (path: string) => Promise<void>

let openHandler: OpenHandler | null = null

type DropTarget = (paths: string[]) => void

/** Takes dropped PDFs instead of opening them (the merge page lists them). */
let dropTarget: DropTarget | null = null

/**
 * Sends dropped PDFs to `target` until the returned function is called
 * (a newer target replaces it; releasing an old one leaves the newer in place).
 */
export function setDropTarget(target: DropTarget): () => void {
  dropTarget = target
  return () => {
    if (dropTarget === target) dropTarget = null
  }
}

function onDrop(paths: readonly string[]): void {
  if (!dropTarget) return void openFiles(paths)
  const pdfs = pdfPaths(paths)
  if (pdfs.length > 0) dropTarget(pdfs)
}

export function pdfPaths(paths: readonly string[]): string[] {
  return paths.filter((p) => p.toLowerCase().endsWith('.pdf'))
}

/** Opens each PDF of `paths` in a tab (a failing file is reported and skipped). */
export async function openFiles(paths: readonly string[]): Promise<void> {
  const open = openHandler
  if (!open) return
  // One failing file must not stop the others.
  for (const p of pdfPaths(paths)) {
    try {
      await open(p)
    } catch (e) {
      console.error(`Failed to open ${p}`, e)
      toasts.show(openErrorMessage(e, p), 'error')
    }
  }
}

/**
 * Opens a file from the start page's recent list. A file that is gone is
 * dropped from the list (`forget`); any other failure is only reported (the
 * file may be locked for a moment).
 */
export async function openRecentFile(path: string, forget: (path: string) => void): Promise<void> {
  const open = openHandler
  if (!open) return
  try {
    await open(path)
  } catch (e) {
    console.error(`Failed to open ${path}`, e)
    if (isAppError(e) && e.code === 'NotFound') {
      forget(path)
      toasts.show(`${fileNameOf(path)} was not found and was removed from recent files`, 'warning')
    } else {
      toasts.show(openErrorMessage(e, path), 'error')
    }
  }
}

export async function pickAndOpen(): Promise<void> {
  const picked = await openDialog({
    multiple: true,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!picked) return
  await openFiles(Array.isArray(picked) ? picked : [picked])
}

export function initFileOpening(open: OpenHandler): () => void {
  openHandler = open
  let disposed = false
  const unlisteners: Array<() => void> = []
  const track = (p: Promise<() => void>) =>
    p.then((un) => (disposed ? un() : unlisteners.push(un)))

  track(
    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') onDrop(e.payload.paths)
    }),
  )
  track(listen<string[]>('open-files', (e) => void openFiles(e.payload)))
  void getLaunchFiles().then((files) => openFiles(files))

  return () => {
    disposed = true
    unlisteners.forEach((un) => un())
    if (openHandler === open) openHandler = null
  }
}
