/**
 * The shortcut catalog: every keyboard shortcut of the app, the single source
 * of truth for which keys run what. The keybinding registry binds from it
 * (bindShortcut), Settings → Shortcuts lists it, and tooltips quote it
 * (shortcutHint), so no other code names a command's keys.
 *
 * Chords use the format of `chordFromEvent` (`Ctrl+Alt+Shift+Key`, with
 * `Plus` and `Space` spelled out). Tool letters are not here: they come with
 * each tool (`ToolDefinition.shortcut`) and the toolbar decides which apply.
 *
 * Ready for customizing (#169): `chordsFor` is the one place that decides a
 * command's keys; user overrides go there, and everything else follows.
 */
import type { KeybindingRegistry } from './keybindings'

export type ShortcutGroup = 'files' | 'view' | 'selection' | 'tools' | 'study' | 'builder'

/** The groups in the order Settings → Shortcuts shows them. */
export const SHORTCUT_GROUPS: readonly { id: ShortcutGroup; label: string }[] = [
  { id: 'files', label: 'Files & tabs' },
  { id: 'view', label: 'View & navigation' },
  { id: 'selection', label: 'Selection & editing' },
  { id: 'tools', label: 'Tools' },
  { id: 'study', label: 'Study' },
  { id: 'builder', label: 'Document builder' },
]

export interface ShortcutEntry {
  /** The command id (for a `fixed` entry, an id of its own). */
  id: string
  group: ShortcutGroup
  /** What it does, as the list shows it. */
  label: string
  /** The keys shown and bound, best first. */
  defaultChords: readonly string[]
  /**
   * Bound too but not shown: the same key on other keyboard layouts (on
   * Swiss/German keyboards "+" needs Shift, so Ctrl+Plus arrives as
   * Ctrl+Shift+Plus).
   */
  variants?: readonly string[]
  /** When it applies, for a key that does different things in different situations. */
  context?: string
  /**
   * Handled by a component's own key handler, not the registry: listed, never
   * bound from here (and not customizable until it moves into a command, #169).
   */
  fixed?: true
}

export const SHORTCUTS: readonly ShortcutEntry[] = [
  // Files & tabs
  { id: 'file.open', group: 'files', label: 'Open a PDF', defaultChords: ['Ctrl+O'] },
  { id: 'file.save', group: 'files', label: 'Save into the PDF', defaultChords: ['Ctrl+S'] },
  { id: 'file.saveAs', group: 'files', label: 'Save as', defaultChords: ['Ctrl+Shift+S'] },
  { id: 'tab.close', group: 'files', label: 'Close tab', defaultChords: ['Ctrl+W'] },
  { id: 'tab.next', group: 'files', label: 'Next tab', defaultChords: ['Ctrl+Tab'] },
  { id: 'tab.prev', group: 'files', label: 'Previous tab', defaultChords: ['Ctrl+Shift+Tab'] },
  { id: 'app.settings', group: 'files', label: 'Settings', defaultChords: ['Ctrl+,'] },
  { id: 'app.shortcuts', group: 'files', label: 'Keyboard shortcuts', defaultChords: ['F1'] },

  // View & navigation
  { id: 'view.find', group: 'view', label: 'Find', defaultChords: ['Ctrl+F'] },
  {
    id: 'view.zoomIn',
    group: 'view',
    label: 'Zoom in',
    defaultChords: ['Ctrl+Plus'],
    variants: ['Ctrl+=', 'Ctrl+Shift+Plus'],
  },
  { id: 'view.zoomOut', group: 'view', label: 'Zoom out', defaultChords: ['Ctrl+-'] },
  { id: 'view.fitWidth', group: 'view', label: 'Fit width', defaultChords: ['Ctrl+0'] },
  {
    id: 'view.nextPage',
    group: 'view',
    label: 'Next page',
    defaultChords: ['ArrowRight'],
    context: 'Nothing selected',
  },
  {
    id: 'view.previousPage',
    group: 'view',
    label: 'Previous page',
    defaultChords: ['ArrowLeft'],
    context: 'Nothing selected',
  },
  {
    id: 'view.thumbnails',
    group: 'view',
    label: 'Page thumbnails',
    defaultChords: ['Ctrl+B', 'F4'],
    context: 'Ctrl+B: no text box selected',
  },
  { id: 'view.fullscreen', group: 'view', label: 'Fullscreen', defaultChords: ['F11'] },
  {
    id: 'view.exitFullscreen',
    group: 'view',
    label: 'Leave fullscreen',
    defaultChords: ['Escape'],
    context: 'In fullscreen',
  },
  {
    id: 'view.pan',
    group: 'view',
    label: 'Pan the page (hold and drag)',
    defaultChords: ['Space'],
    fixed: true,
  },

  // Selection & editing
  { id: 'edit.undo', group: 'selection', label: 'Undo', defaultChords: ['Ctrl+Z'] },
  { id: 'edit.redo', group: 'selection', label: 'Redo', defaultChords: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'edit.copy', group: 'selection', label: 'Copy', defaultChords: ['Ctrl+C'] },
  { id: 'edit.cut', group: 'selection', label: 'Cut', defaultChords: ['Ctrl+X'] },
  { id: 'edit.paste', group: 'selection', label: 'Paste', defaultChords: ['Ctrl+V'] },
  { id: 'edit.duplicate', group: 'selection', label: 'Duplicate', defaultChords: ['Ctrl+D'] },
  {
    id: 'edit.delete',
    group: 'selection',
    label: 'Delete',
    defaultChords: ['Delete', 'Backspace'],
  },
  { id: 'edit.deselect', group: 'selection', label: 'Deselect', defaultChords: ['Escape'] },
  {
    id: 'edit.nudgeLeft',
    group: 'selection',
    label: 'Move left (1 pt)',
    defaultChords: ['ArrowLeft'],
    context: 'With a selection',
  },
  {
    id: 'edit.nudgeRight',
    group: 'selection',
    label: 'Move right (1 pt)',
    defaultChords: ['ArrowRight'],
    context: 'With a selection',
  },
  {
    id: 'edit.nudgeUp',
    group: 'selection',
    label: 'Move up (1 pt)',
    defaultChords: ['ArrowUp'],
    context: 'With a selection',
  },
  {
    id: 'edit.nudgeDown',
    group: 'selection',
    label: 'Move down (1 pt)',
    defaultChords: ['ArrowDown'],
    context: 'With a selection',
  },
  {
    id: 'edit.nudgeLeftFar',
    group: 'selection',
    label: 'Move left (10 pt)',
    defaultChords: ['Shift+ArrowLeft'],
  },
  {
    id: 'edit.nudgeRightFar',
    group: 'selection',
    label: 'Move right (10 pt)',
    defaultChords: ['Shift+ArrowRight'],
  },
  {
    id: 'edit.nudgeUpFar',
    group: 'selection',
    label: 'Move up (10 pt)',
    defaultChords: ['Shift+ArrowUp'],
  },
  {
    id: 'edit.nudgeDownFar',
    group: 'selection',
    label: 'Move down (10 pt)',
    defaultChords: ['Shift+ArrowDown'],
  },
  // Ctrl+Shift+] arrives as Ctrl+Shift+} on layouts where Shift changes the bracket.
  {
    id: 'edit.bringToFront',
    group: 'selection',
    label: 'Bring to front',
    defaultChords: ['Ctrl+Shift+]'],
    variants: ['Ctrl+Shift+}'],
  },
  {
    id: 'edit.bringForward',
    group: 'selection',
    label: 'Bring forward',
    defaultChords: ['Ctrl+]'],
  },
  {
    id: 'edit.sendBackward',
    group: 'selection',
    label: 'Send backward',
    defaultChords: ['Ctrl+['],
  },
  {
    id: 'edit.sendToBack',
    group: 'selection',
    label: 'Send to back',
    defaultChords: ['Ctrl+Shift+['],
    variants: ['Ctrl+Shift+{'],
  },
  {
    id: 'text.bold',
    group: 'selection',
    label: 'Bold',
    defaultChords: ['Ctrl+B'],
    context: 'Text boxes selected',
  },
  {
    id: 'text.italic',
    group: 'selection',
    label: 'Italic',
    defaultChords: ['Ctrl+I'],
    context: 'Text boxes selected',
  },

  // Tools (the tool letters come from the toolbar, see the tab)
  {
    id: 'tool.escapeToSelect',
    group: 'tools',
    label: 'Back to the select tool',
    defaultChords: ['Escape'],
    fixed: true,
  },
  {
    id: 'shape.finishPolyline',
    group: 'tools',
    label: 'Finish the polyline',
    defaultChords: ['Enter'],
    context: 'Drawing a polyline',
    fixed: true,
  },
  {
    id: 'shape.removePoint',
    group: 'tools',
    label: 'Remove the last point',
    defaultChords: ['Backspace'],
    context: 'Drawing a polyline',
    fixed: true,
  },
  {
    id: 'shape.cancelPolyline',
    group: 'tools',
    label: 'Drop the polyline',
    defaultChords: ['Escape'],
    context: 'Drawing a polyline',
    fixed: true,
  },

  // Study
  { id: 'view.hideAnnotations', group: 'study', label: 'Hide annotations', defaultChords: ['H'] },
  { id: 'view.memoryMode', group: 'study', label: 'Memory mode', defaultChords: ['Q'] },
  {
    id: 'view.coverHighlights',
    group: 'study',
    label: 'Cover highlights again',
    defaultChords: ['Shift+Q'],
    context: 'In memory mode',
  },

  // Document builder (its own key handler while it is open)
  {
    id: 'builder.selectAll',
    group: 'builder',
    label: 'Select all pages / none',
    defaultChords: ['Ctrl+A'],
    fixed: true,
  },
  {
    id: 'builder.duplicate',
    group: 'builder',
    label: 'Duplicate pages',
    defaultChords: ['Ctrl+D'],
    fixed: true,
  },
  {
    id: 'builder.remove',
    group: 'builder',
    label: 'Remove pages',
    defaultChords: ['Delete', 'Backspace'],
    fixed: true,
  },
  {
    id: 'builder.close',
    group: 'builder',
    label: 'Clear the selection, then close',
    defaultChords: ['Escape'],
    fixed: true,
  },
  {
    id: 'builder.moveFile',
    group: 'builder',
    label: 'Move a file up / down (merge)',
    defaultChords: ['Alt+ArrowUp', 'Alt+ArrowDown'],
    fixed: true,
  },
]

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]))

export function shortcutEntry(id: string): ShortcutEntry | undefined {
  return byId.get(id)
}

/** The keys of a command, as shown; the one place that decides them (overrides go here, #169). */
export function chordsFor(id: string): readonly string[] {
  return byId.get(id)?.defaultChords ?? []
}

/**
 * Binds a command's keys (shown ones and layout variants) where its module
 * registers it, so commands that share a key keep their order (the first
 * enabled one runs). Throws for a command the catalog doesn't know or
 * lists as fixed: a programming error a test catches.
 */
export function bindShortcut(keys: KeybindingRegistry, id: string): () => void {
  const entry = byId.get(id)
  if (!entry || entry.fixed) throw new Error(`No bindable shortcut "${id}" in the catalog`)
  const disposers = [...chordsFor(id), ...(entry.variants ?? [])].map((c) => keys.bind(c, id))
  return () => disposers.forEach((d) => d())
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: 'Del',
  Escape: 'Esc',
  Plus: '+',
}

/** The key caps of a chord: `Ctrl+Shift+ArrowLeft` → `['Ctrl', 'Shift', '←']`. */
export function keyCaps(chord: string): string[] {
  // Split on "+" between parts only: a chord's last part may itself be "+"-free
  // ("Plus" is spelled out), so a plain split is safe.
  return chord.split('+').map((k) => KEY_NAMES[k] ?? k)
}

/** A chord as text: `Ctrl+Shift+ArrowLeft` → `Ctrl+Shift+←`. */
export function chordLabel(chord: string): string {
  return keyCaps(chord).join('+')
}

/** A command's keys for a tooltip: `Ctrl+B / F4`; empty when it has none. */
export function shortcutHint(id: string): string {
  return chordsFor(id).map(chordLabel).join(' / ')
}

/** `label (keys)` for a tooltip, or just `label` when the command has no keys. */
export function withShortcut(label: string, id: string): string {
  const hint = shortcutHint(id)
  return hint ? `${label} (${hint})` : label
}

/** A row of Settings → Shortcuts. */
export interface ShortcutRow {
  id: string
  label: string
  /** The keys shown (no layout variants). */
  chords: readonly string[]
  context?: string
  /** Not editable once shortcuts can be customized (#169): handled outside the registry. */
  fixed: boolean
}

export interface ShortcutSection {
  group: ShortcutGroup
  label: string
  rows: ShortcutRow[]
}

/**
 * What Settings → Shortcuts lists: every group in order with its catalog
 * entries, and `tools` (the current toolbar's tools that have a letter, in
 * toolbar order) first under Tools.
 */
export function shortcutSections(
  tools: readonly { type: string; displayName: string; shortcut: string }[],
): ShortcutSection[] {
  return SHORTCUT_GROUPS.map(({ id: group, label }) => {
    const toolRows: ShortcutRow[] =
      group === 'tools'
        ? tools.map((t) => ({
            id: `tool.${t.type}`,
            label: t.displayName,
            chords: [t.shortcut.toUpperCase()],
            fixed: false,
          }))
        : []
    const rows = SHORTCUTS.filter((s) => s.group === group).map((s): ShortcutRow => ({
      id: s.id,
      label: s.label,
      chords: s.fixed ? s.defaultChords : chordsFor(s.id),
      ...(s.context ? { context: s.context } : {}),
      fixed: s.fixed === true,
    }))
    return { group, label, rows: [...toolRows, ...rows] }
  })
}
