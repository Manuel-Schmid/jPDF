import { toasts } from '../../ui/toasts.svelte'
import { commands, type CommandRegistry } from './commands'

export function chordFromEvent(e: KeyboardEvent): string {
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key === '+') key = 'Plus'
  else if (key.length === 1) key = key.toUpperCase()

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Default handler for a command that threw: log it and tell the user. */
function reportCommandError(id: string, e: unknown): void {
  console.error(`Command ${id} failed`, e)
  toasts.show('Something went wrong', 'error')
}

/** Bare keys typed while focus is inside a popup (flyout, modal, menu) belong to it. */
const POPUP_SELECTOR = '[role="dialog"], [role="menu"]'

/** The clipboard chords, which an editable field keeps for its own text. */
const CLIPBOARD_KEYS = new Set(['Ctrl+C', 'Ctrl+X', 'Ctrl+V'])

function isInsidePopup(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(POPUP_SELECTOR) !== null
}

export class KeybindingRegistry {
  /** Several commands may share a chord: they are tried in registration order, the first enabled one runs. */
  private bindings = new Map<string, string[]>()
  /**
   * Commands whose keys are read at each key press (bindShortcut: the user may
   * change them), in registration order. They are tried before `bindings`.
   */
  private live: { id: string; chords: () => readonly string[] }[] = []

  constructor(
    private cmds: CommandRegistry,
    private onError: (id: string, e: unknown) => void = reportCommandError,
  ) {}

  bind(chord: string, commandId: string): () => void {
    const ids = this.bindings.get(chord) ?? []
    if (!ids.includes(commandId)) ids.push(commandId)
    this.bindings.set(chord, ids)
    return () => {
      const cur = this.bindings.get(chord)
      if (!cur) return
      const rest = cur.filter((id) => id !== commandId)
      if (rest.length > 0) this.bindings.set(chord, rest)
      else this.bindings.delete(chord)
    }
  }

  /**
   * Binds `commandId` to whatever `chords` returns at the time of each key
   * press, so changed keys apply at once and the command keeps its place
   * among those sharing a key. Returns the disposer.
   */
  bindLive(commandId: string, chords: () => readonly string[]): () => void {
    const entry = { id: commandId, chords }
    this.live.push(entry)
    return () => {
      this.live = this.live.filter((e) => e !== entry)
    }
  }

  /** The chords bound to `commandId`, live ones first. */
  chordsOf(commandId: string): string[] {
    const live = this.live.filter((e) => e.id === commandId).flatMap((e) => e.chords())
    const fixed = [...this.bindings].filter(([, ids]) => ids.includes(commandId)).map(([chord]) => chord)
    return [...new Set([...live, ...fixed])]
  }

  /** The commands bound to `chord`, in the order they are tried. */
  private commandsFor(chord: string): string[] {
    const live = this.live.filter((e) => e.chords().includes(chord)).map((e) => e.id)
    return [...live, ...(this.bindings.get(chord) ?? [])]
  }

    handle(e: KeyboardEvent): boolean {
    const bare = !e.ctrlKey && !e.altKey
    // Bare keys (no Ctrl/Alt) are typing in an editable field or acting inside a
    // popup (a focused swatch must not delete the selection); F-keys and Escape still pass.
    if (bare && e.key !== 'Escape' && !/^F\d+$/.test(e.key) && (isEditableTarget(e.target) || isInsidePopup(e.target))) {
      return false
    }
    // An arrow key a focused widget already used (a segmented control, a resize
    // handle) is not also a shortcut (it would nudge the selection too).
    if (e.defaultPrevented && e.key.startsWith('Arrow')) return false
    // Copy, cut and paste in an editable field act on its text, not the document.
    if (CLIPBOARD_KEYS.has(chordFromEvent(e)) && isEditableTarget(e.target)) return false
    const id = this.commandsFor(chordFromEvent(e)).find((c) => this.cmds.canExecute(c))
    if (id === undefined) return false
    // Fire and forget: the caller needs a synchronous answer for preventDefault.
    this.cmds.execute(id).catch((err) => this.onError(id, err))
    return true
  }
}

export const keybindings = new KeybindingRegistry(commands)
