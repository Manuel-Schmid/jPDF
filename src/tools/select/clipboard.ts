import type { PageViewport } from 'pdfjs-dist'
import type { ClipboardImage } from '../../core/ipc/clipboard'
import { commands as defaultCommands, type CommandRegistry } from '../../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../../core/registry/keybindings'
import { annotationKinds } from '../../core/registry/annotationKinds'
import type { PageFrame } from '../../core/registry/tools'
import { addAnnotations, deleteAnnotations } from '../../core/session/commands'
import { newId, type Annotation, type Point, type Rect } from '../../core/session/model'
import { DUPLICATE_OFFSET, selectedAnnotations, type SelectionTarget } from './commands'
import { toPdfRect } from './handles'

/** Where a paste lands: a page (0-based) with its viewport, and the pointer's PDF point when it is over that page. */
export interface PasteSpot {
  page: number
  vp: PageViewport
  at: Point | null
}

/** The document pasted into or copied from: the active session, its tool state and where a paste lands. */
export interface ClipboardTarget extends SelectionTarget {
  /** The page under the pointer, else the visible page; null when no page is shown. */
  pasteSpot(): PasteSpot | null
  /** Makes pasted annotations the selection (when the active tool has one). */
  select(ids: string[]): void
  /** Pastes an image from the system clipboard at `spot` (one undo step). */
  pasteImage(spot: PasteSpot, img: ClipboardImage): Promise<void>
}

/** The system clipboard (tauri-plugin-clipboard-manager in the app, a fake in tests). */
export interface SystemClipboard {
  writeText(text: string): Promise<void>
  /** null when it holds no text or cannot be read. */
  readText(): Promise<string | null>
  readImage(): Promise<ClipboardImage | null>
}

/**
 * The spot of the mounted page (`frames`, 0-based) under the pointer at
 * `client`, else `fallback` (the visible page) when it is mounted. Page boxes
 * are taken at their viewport size (a zoom preview's CSS scaling is ignored).
 */
export function spotAt(
  frames: ReadonlyMap<number, () => PageFrame | null>,
  client: Point | null,
  fallback: number,
): PasteSpot | null {
  if (client) {
    for (const [page, frameOf] of frames) {
      const f = frameOf()
      if (!f) continue
      const x = client[0] - f.origin[0]
      const y = client[1] - f.origin[1]
      if (x < 0 || y < 0 || x > f.vp.width || y > f.vp.height) continue
      const [px, py] = f.vp.convertToPdfPoint(x, y)
      return { page, vp: f.vp, at: [px, py] }
    }
  }
  const f = frames.get(fallback)?.()
  return f ? { page: fallback, vp: f.vp, at: null } : null
}

/** The union of the annotations' bounds. */
function boundsOf(list: readonly Annotation[]): Rect {
  return list
    .map((a) => annotationKinds.get(a.kind).bounds(a))
    .reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])])
}

/** The shift along one axis that brings [lo, hi] inside [min, max]; one too long keeps its `keep` end inside. */
function fitShift(lo: number, hi: number, min: number, max: number, keep: 'lo' | 'hi'): number {
  if (hi - lo > max - min) return keep === 'lo' ? min - lo : max - hi
  return lo < min ? min - lo : hi > max ? max - hi : 0
}

/**
 * Copies of `items` for page `page` (new ids, not yet saved): at their own
 * position shifted `steps` times by DUPLICATE_OFFSET (right and down on an
 * upright page), then moved together so the group stays on `pageRect` (PDF
 * space). A group larger than the page keeps its top-left corner on it.
 */
export function placePasted(
  items: readonly Annotation[],
  page: number,
  pageRect: Rect,
  steps: number,
  modifiedAt = new Date().toISOString(),
): Annotation[] {
  if (items.length === 0) return []
  const d = steps * DUPLICATE_OFFSET
  const shifted = items.map((a) => annotationKinds.get(a.kind).translate(a, d, -d))
  const b = boundsOf(shifted)
  const dx = fitShift(b[0], b[2], pageRect[0], pageRect[2], 'lo')
  const dy = fitShift(b[1], b[3], pageRect[1], pageRect[3], 'hi')
  return shifted.map((a) => ({
    ...annotationKinds.get(a.kind).translate(a, dx, dy),
    id: newId(),
    page,
    sourceRef: null,
    modifiedAt,
  }))
}

/** What a copy writes to the system clipboard: the text of copied text boxes, else a label. */
export function clipboardText(list: readonly Annotation[]): string {
  const text = list.flatMap((a) => (a.kind === 'freetext' && a.text.trim() !== '' ? [a.text] : [])).join('\n')
  if (text !== '') return text
  return list.length === 1 ? '1 annotation (JuliePDF)' : `${list.length} annotations (JuliePDF)`
}

/** Line endings as the system clipboard may hand them back (Windows: CRLF). */
const normalize = (s: string) => s.replace(/\r\n/g, '\n')

/**
 * The in-app clipboard: the last copied or cut annotations (their model JSON),
 * shared by all tabs. The copy also writes a marker text to the system
 * clipboard; a paste takes the annotations only while that text is still
 * there, so whatever was copied in another app since (an image, text) wins.
 */
export class AnnotationClipboard {
  private items: Annotation[] = []
  /** The text written to the system clipboard; null when writing it failed (the annotations are then current). */
  private marker: string | null = null
  /** The pending write of the marker, awaited by a paste. */
  private writing: Promise<void> = Promise.resolve()
  /** Where the items came from: originals still sit there unless cut. */
  private origin: { session: string; pages: Set<number>; cut: boolean } | null = null
  /** Pastes so far per `session:page`, to step each further from the last. */
  private pastes = new Map<string, number>()

  get empty(): boolean {
    return this.items.length === 0
  }

  /** Holds copies of `list` (from session `session`) and marks them on the system clipboard. */
  copy(list: readonly Annotation[], session: string, cut: boolean, system: SystemClipboard): void {
    this.items = JSON.parse(JSON.stringify(list)) as Annotation[]
    this.origin = { session, pages: new Set(list.map((a) => a.page)), cut }
    this.pastes.clear()
    const text = clipboardText(list)
    this.marker = text
    this.writing = system.writeText(text).catch((e) => {
      console.error('Could not write to the clipboard', e)
      if (this.marker === text) this.marker = null
    })
  }

  /** Whether the system clipboard still holds this copy's marker (nothing was copied elsewhere since). */
  async current(system: SystemClipboard): Promise<boolean> {
    if (this.empty) return false
    await this.writing
    const marker = this.marker
    if (marker === null) return true
    const text = await system.readText().catch(() => null)
    return text !== null && normalize(text) === normalize(marker)
  }

  /**
   * Copies for page `page` of session `session`: offset from the originals
   * when they are on that page (not after a cut), and from each earlier paste
   * there (see placePasted).
   */
  paste(session: string, page: number, pageRect: Rect): Annotation[] {
    const key = `${session}:${page}`
    const done = this.pastes.get(key) ?? 0
    const o = this.origin
    const originals = o !== null && !o.cut && o.session === session && o.pages.has(page) ? 1 : 0
    this.pastes.set(key, done + 1)
    return placePasted(this.items, page, pageRect, done + originals)
  }
}

/** Off while a text box is edited (its keys go to the editor). */
function canCopy(t: ClipboardTarget | null): t is ClipboardTarget {
  return t !== null && t.state.textEdit === null && selectedAnnotations(t).length > 0
}

/**
 * Registers edit.copy (Ctrl+C), edit.cut (Ctrl+X: deletes the selection) and
 * edit.paste (Ctrl+V). Copy and cut are off without a selection, so Ctrl+C
 * still copies selected page text then. Paste puts the copied annotations on
 * the page under the pointer (else the visible page), clamped to it, and
 * selects them; when something else was copied since (see
 * AnnotationClipboard), it pastes the system clipboard's image instead, if
 * any. All are off while a text box is edited. Each change is one undo step.
 */
export function registerClipboardCommands(
  active: () => ClipboardTarget | null,
  system: SystemClipboard,
  clip: AnnotationClipboard = new AnnotationClipboard(),
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = [
    commands.register({
      id: 'edit.copy',
      title: 'Copy selection',
      enabled: () => canCopy(active()),
      run: () => {
        const t = active()
        if (canCopy(t)) clip.copy(selectedAnnotations(t), t.session.id, false, system)
      },
    }),
    keybindings.bind('Ctrl+C', 'edit.copy'),
    commands.register({
      id: 'edit.cut',
      title: 'Cut selection',
      enabled: () => canCopy(active()),
      run: () => {
        const t = active()
        if (!canCopy(t)) return
        const list = selectedAnnotations(t)
        clip.copy(list, t.session.id, true, system)
        t.state.selection = []
        t.session.history.execute({ ...deleteAnnotations(list), label: 'Cut annotations' })
      },
    }),
    keybindings.bind('Ctrl+X', 'edit.cut'),
    commands.register({
      id: 'edit.paste',
      title: 'Paste',
      enabled: () => {
        const t = active()
        return t !== null && t.state.textEdit === null
      },
      run: async () => {
        const t = active()
        const spot = t?.pasteSpot()
        if (!t || !spot) return
        if (await clip.current(system)) {
          const copies = clip.paste(t.session.id, spot.page, toPdfRect([0, 0, spot.vp.width, spot.vp.height], spot.vp))
          t.session.commitPendingEdit()
          t.session.history.execute({ ...addAnnotations(copies), label: 'Paste annotations' })
          t.select(copies.map((a) => a.id))
          return
        }
        const img = await system.readImage()
        if (img) await t.pasteImage(spot, img)
      },
    }),
    keybindings.bind('Ctrl+V', 'edit.paste'),
  ]
  return () => disposers.forEach((d) => d())
}
