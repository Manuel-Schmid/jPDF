import { commands as defaultCommands, type CommandRegistry } from '../../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../../core/registry/keybindings'
import { annotationKinds } from '../../core/registry/annotationKinds'
import {
  addAnnotations, deleteAnnotations, flattenAnnotations, reorderAnnotations, restackedPages, updateAnnotation, updateAnnotations,
  Z_ORDER_LABELS, type ZOrder,
} from '../../core/session/commands'
import { isEditable, newId, type Annotation } from '../../core/session/model'
import type { DocumentSession } from '../../core/session/session.svelte'
import type { SessionToolState } from '../../core/session/toolState.svelte'
import { toasts } from '../../ui/toasts.svelte'
import { layoutFreeText } from '../text/editing'

export interface SelectionTarget {
  session: DocumentSession
  state: Pick<SessionToolState, 'selection' | 'textEdit'>
}

/** How far (pt) a duplicate is placed from its original: right and down on an upright page. */
export const DUPLICATE_OFFSET = 12

/** The selected annotations that still exist and can be edited, in selection order. */
function selectedAnnotations({ session, state }: SelectionTarget): Annotation[] {
  return state.selection.flatMap((id) => {
    const a = session.store.get(id)
    return a && isEditable(a) ? [a] : []
  })
}

/** Selection commands are off while a text box is edited (its keys go to the editor). */
function canEditSelection(t: SelectionTarget | null): t is SelectionTarget {
  return t !== null && t.state.textEdit === null && selectedAnnotations(t).length > 0
}

/**
 * The z-order commands and their keys: Ctrl+] / Ctrl+[ one step, with Shift
 * all the way. Shift+] types `}` on US layouts (chordFromEvent keeps the
 * typed character), so both spellings are bound.
 */
export const Z_ORDER_COMMANDS: readonly { id: string; how: ZOrder; chords: string[] }[] = [
  { id: 'edit.bringToFront', how: 'front', chords: ['Ctrl+Shift+]', 'Ctrl+Shift+}'] },
  { id: 'edit.bringForward', how: 'forward', chords: ['Ctrl+]'] },
  { id: 'edit.sendBackward', how: 'backward', chords: ['Ctrl+['] },
  { id: 'edit.sendToBack', how: 'back', chords: ['Ctrl+Shift+[', 'Ctrl+Shift+{'] },
]

/** Whether restacking the selection `how` would change any page's order. */
function canRestack(t: SelectionTarget | null, how: ZOrder): t is SelectionTarget {
  return canEditSelection(t) && restackedPages(t.session.store, selectedAnnotations(t), how).length > 0
}

/**
 * Independent copies of `list` (new ids, not yet saved), shifted by
 * DUPLICATE_OFFSET so they do not hide their originals.
 */
export function duplicatesOf(list: Annotation[], modifiedAt = new Date().toISOString()): Annotation[] {
  return list.map((a) => ({
    ...annotationKinds.get(a.kind).translate(a, DUPLICATE_OFFSET, -DUPLICATE_OFFSET),
    id: newId(),
    sourceRef: null,
    modifiedAt,
  }))
}

/**
 * Registers the commands acting on the selection of the active session:
 * edit.delete (Delete, Backspace), edit.duplicate (Ctrl+D: the copies become
 * the selection), edit.flatten (burns the selection into the page on the
 * next save), the z-order commands (Z_ORDER_COMMANDS: Ctrl+[ / Ctrl+], with
 * Shift to the bottom / top; each off while it would move nothing) and
 * edit.deselect (Escape). All but deselect are off while a
 * text box is edited; all are off without a selection, so the keys pass
 * through then. Each change is one undo step.
 */
export function registerSelectionCommands(
  active: () => SelectionTarget | null,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = [
    commands.register({
      id: 'edit.delete',
      title: 'Delete selection',
      enabled: () => canEditSelection(active()),
      run: () => {
        const t = active()
        if (!t) return
        const list = selectedAnnotations(t)
        t.state.selection = []
        if (list.length > 0) t.session.history.execute(deleteAnnotations(list))
      },
    }),
    keybindings.bind('Delete', 'edit.delete'),
    keybindings.bind('Backspace', 'edit.delete'),
    commands.register({
      id: 'edit.duplicate',
      title: 'Duplicate selection',
      enabled: () => canEditSelection(active()),
      run: () => {
        const t = active()
        if (!canEditSelection(t)) return
        const copies = duplicatesOf(selectedAnnotations(t))
        t.session.history.execute({ ...addAnnotations(copies), label: 'Duplicate annotations' })
        t.state.selection = copies.map((a) => a.id)
      },
    }),
    keybindings.bind('Ctrl+D', 'edit.duplicate'),
    commands.register({
      id: 'edit.flatten',
      title: 'Flatten selection into the page',
      enabled: () => canEditSelection(active()),
      run: () => {
        const t = active()
        if (!canEditSelection(t)) return
        const list = selectedAnnotations(t)
        t.state.selection = []
        t.session.history.execute(flattenAnnotations(list))
      },
    }),
    ...Z_ORDER_COMMANDS.flatMap(({ id, how, chords }) => [
      commands.register({
        id,
        title: Z_ORDER_LABELS[how],
        enabled: () => canRestack(active(), how),
        run: () => {
          const t = active()
          if (canRestack(t, how)) t.session.history.execute(reorderAnnotations(selectedAnnotations(t), how))
        },
      }),
      ...chords.map((c) => keybindings.bind(c, id)),
    ]),
    commands.register({
      id: 'edit.deselect',
      title: 'Deselect',
      enabled: () => (active()?.state.selection.length ?? 0) > 0,
      run: () => {
        const t = active()
        if (t) t.state.selection = []
      },
    }),
    keybindings.bind('Escape', 'edit.deselect'),
  ]
  return () => disposers.forEach((d) => d())
}

const withoutTime = (a: Annotation) => JSON.stringify({ ...a, modifiedAt: '' })

/**
 * Commits edits of selected annotations (the selection's Style card) as one
 * undo step; no step when nothing changed. Each of `afters` is an annotation
 * with the user's changes: those fields (relative to the annotation as it is
 * now) are applied to the annotation as it is when the edit commits, so a
 * change made meanwhile is not overwritten. A text box whose font size
 * changed is laid out again (lines re-wrapped, height fitted), which needs its
 * page's rotation. Failures are reported to the user, never thrown.
 */
export async function editAnnotations(session: DocumentSession, afters: readonly Annotation[]): Promise<void> {
  try {
    const edits = afters.flatMap((after) => {
      const before = session.store.get(after.id)
      if (!before) return []
      const patch = Object.fromEntries(
        Object.entries(after).filter(
          ([k, v]) => JSON.stringify(v) !== JSON.stringify((before as unknown as Record<string, unknown>)[k]),
        ),
      )
      return [{ id: after.id, page: before.page, patch, relayout: before.kind === 'freetext' && 'fontSize' in patch }]
    })
    const rotations = await Promise.all(edits.map((e) => (e.relayout ? session.pageRotation(e.page) : 0)))
    const now = new Date().toISOString()
    const changes = edits.flatMap((e, i) => {
      // The current version: the annotation may have changed (or gone) while waiting.
      const current = session.store.get(e.id)
      if (!current) return []
      let next = { ...current, ...e.patch } as Annotation
      if (e.relayout && next.kind === 'freetext') next = layoutFreeText(next, next.text, rotations[i])
      if (withoutTime(current) === withoutTime(next)) return []
      return [{ before: current, after: { ...next, modifiedAt: now } }]
    })
    if (changes.length === 1) session.history.execute(updateAnnotation(changes[0].before, changes[0].after))
    else if (changes.length > 1) session.history.execute(updateAnnotations('Edit style', changes))
  } catch (e) {
    console.error('Could not edit the selected annotations', e)
    toasts.show('Could not apply the change', 'error')
  }
}

/** editAnnotations for one annotation. */
export function editSelected(session: DocumentSession, after: Annotation): Promise<void> {
  return editAnnotations(session, [after])
}
