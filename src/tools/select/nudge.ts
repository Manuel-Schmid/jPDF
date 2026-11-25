import { commands as defaultCommands, type CommandRegistry } from '../../core/registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../../core/registry/keybindings'
import { annotationKinds } from '../../core/registry/annotationKinds'
import { normalizeRotation } from '../../core/geometry/textLayout'
import { updateAnnotation, updateAnnotations } from '../../core/session/commands'
import type { Command } from '../../core/session/history.svelte'
import type { Annotation, Point, Rect } from '../../core/session/model'
import type { DocumentSession } from '../../core/session/session.svelte'
import { toasts } from '../../ui/toasts.svelte'
import { clampShift } from './crossPage'
import { selectedAnnotations, type SelectionTarget } from './commands'

/** How far (pt) an arrow key moves the selection; with Shift, NUDGE_BIG_STEP. */
export const NUDGE_STEP = 1
export const NUDGE_BIG_STEP = 10

/** Presses closer together than this (ms) on the same selection are one undo step. */
export const NUDGE_MERGE_MS = 1000

/** The nudge commands: screen direction (right, down) per arrow key. */
const DIRECTIONS: readonly { name: string; key: string; dx: number; dy: number }[] = [
  { name: 'Left', key: 'ArrowLeft', dx: -1, dy: 0 },
  { name: 'Right', key: 'ArrowRight', dx: 1, dy: 0 },
  { name: 'Up', key: 'ArrowUp', dx: 0, dy: -1 },
  { name: 'Down', key: 'ArrowDown', dx: 0, dy: 1 },
]

/**
 * The PDF shift of a move `right` pt right and `down` pt down on screen, on a
 * page with this /Rotate (screen right is +x, +y, -x, -y for 0, 90, 180, 270).
 */
export function screenShift(right: number, down: number, rotation: number): Point {
  switch (normalizeRotation(rotation)) {
    case 90:
      return [down, right]
    case 180:
      return [-right, down]
    case 270:
      return [-down, -right]
    default:
      return [right, -down]
  }
}

/**
 * `a` moved by (`dx`, `dy`) in PDF space, held on `page` (its user-space box)
 * as a drag is: it may not leave the page, but one already partly off may stay
 * where it is. null when it would not move.
 */
export function nudged(a: Annotation, dx: number, dy: number, page: Rect | null): Annotation | null {
  const kind = annotationKinds.get(a.kind)
  if (page) {
    const b = kind.bounds(a)
    dx = clampShift(dx, page[0] - b[0], page[2] - b[2])
    dy = clampShift(dy, page[1] - b[1], page[3] - b[3])
  }
  return dx === 0 && dy === 0 ? null : kind.translate(a, dx, dy)
}

/** The last nudge, while the next one may still join its undo step. */
interface LastNudge {
  session: DocumentSession
  /** The nudged ids, sorted and joined: a different selection starts a new step. */
  key: string
  at: number
  /** The history position right after it: any other change in between starts a new step. */
  stateId: number
  /** Each annotation as it was before the first nudge of the step. */
  originals: Map<string, Annotation>
}

/**
 * Registers the arrow-key nudge of the active session's selection:
 * edit.nudge<Dir> (Arrow keys, NUDGE_STEP) and edit.nudge<Dir>Far
 * (Shift+Arrow, NUDGE_BIG_STEP), in screen directions, for every annotation
 * kind (its translate). Off while a text box is edited (arrows move the
 * caret) and without a selection (Left / Right flip pages, Up / Down
 * scroll). Annotations stay on their page. Holding a key repeats; presses within NUDGE_MERGE_MS of each other on
 * the same selection are one undo step. `clock` is for tests.
 */
export function registerNudgeCommands(
  active: () => SelectionTarget | null,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
  clock: () => number = Date.now,
): () => void {
  let last: LastNudge | null = null

  const can = (t: SelectionTarget | null): t is SelectionTarget =>
    t !== null && t.state.textEdit === null && selectedAnnotations(t).length > 0

  async function nudge(right: number, down: number): Promise<void> {
    const t = active()
    if (!can(t)) return
    const { session } = t
    const pages = [...new Set(selectedAnnotations(t).map((a) => a.page))]
    const geometry = new Map(
      await Promise.all(
        pages.map(async (p) => [p, { rotation: await session.pageRotation(p), box: await session.pageBox(p) }] as const),
      ),
    )
    // The selection as it is now: an earlier press (key repeat) may have moved it meanwhile.
    if (active()?.session !== session || !can(t)) return
    const now = new Date().toISOString()
    const changes = selectedAnnotations(t).flatMap((before) => {
      const g = geometry.get(before.page)
      if (!g) return []
      const [dx, dy] = screenShift(right, down, g.rotation)
      const after = nudged(before, dx, dy, g.box)
      return after ? [{ before, after: { ...after, modifiedAt: now } }] : []
    })
    if (changes.length === 0) return
    const key = changes.map((c) => c.before.id).sort().join('\n')
    const time = clock()
    const cmd = commandFor(changes)
    if (
      last !== null && last.session === session && last.key === key &&
      time - last.at < NUDGE_MERGE_MS && last.stateId === session.history.stateId
    ) {
      const originals = last.originals
      session.history.amend(cmd, commandFor(changes.map((c) => ({ before: originals.get(c.before.id)!, after: c.after }))))
      last = { ...last, at: time, stateId: session.history.stateId }
    } else {
      session.history.execute(cmd)
      last = {
        session, key, at: time, stateId: session.history.stateId,
        originals: new Map(changes.map((c) => [c.before.id, c.before])),
      }
    }
  }

  const disposers = DIRECTIONS.flatMap(({ name, key, dx, dy }) =>
    ([false, true] as const).flatMap((far) => {
      const id = `edit.nudge${name}${far ? 'Far' : ''}`
      const step = far ? NUDGE_BIG_STEP : NUDGE_STEP
      return [
        commands.register({
          id,
          title: `Move selection ${name.toLowerCase()}${far ? ' (far)' : ''}`,
          enabled: () => can(active()),
          run: () =>
            nudge(dx * step, dy * step).catch((e) => {
              console.error('Could not move the selection', e)
              toasts.show('Could not move the selection', 'error')
            }),
        }),
        keybindings.bind(far ? `Shift+${key}` : key, id),
      ]
    }),
  )
  return () => disposers.forEach((d) => d())
}

/** One undo step moving every annotation of `changes`. */
function commandFor(changes: { before: Annotation; after: Annotation }[]): Command {
  const label = changes.length === 1 ? 'Move annotation' : 'Move annotations'
  return changes.length === 1
    ? { ...updateAnnotation(changes[0].before, changes[0].after), label }
    : updateAnnotations(label, changes)
}
