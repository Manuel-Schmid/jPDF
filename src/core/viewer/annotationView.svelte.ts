import { SvelteSet } from 'svelte/reactivity'
import { commands as defaultCommands, type CommandRegistry } from '../registry/commands'
import { keybindings as defaultKeybindings, type KeybindingRegistry } from '../registry/keybindings'
import { bindShortcut } from '../registry/shortcuts'
import { toasts } from '../../ui/toasts.svelte'

/**
 * How annotations are shown, for every page of every tab: all hidden (to see
 * the clean page), or highlights covering their text until clicked (memory
 * mode, for studying). View state only: the file never changes and no tab
 * becomes dirty.
 */
export class AnnotationView {
  /** No annotation is drawn on the pages; the next stroke or click on a page shows them again. */
  hidden = $state(false)
  /** Highlights are drawn opaque, so the text under them can't be read, until clicked. */
  memory = $state(false)
  /** Highlights uncovered by a click while in memory mode (by annotation id). */
  readonly revealed = new SvelteSet<string>()

  toggleHidden(): void {
    this.hidden = !this.hidden
  }

  /** Shows annotations again (a tool started a gesture on a page). */
  show(): void {
    if (this.hidden) this.hidden = false
  }

  /** Turns memory mode on or off; either way every highlight starts covered. */
  toggleMemory(): void {
    this.memory = !this.memory
    this.coverAll()
  }

  /** Whether highlight `id` is drawn covering its text now. */
  covers(id: string): boolean {
    return this.memory && !this.revealed.has(id)
  }

  reveal(id: string): void {
    this.revealed.add(id)
  }

  /** Covers every revealed highlight again (Shift+Q, a page or tab change). */
  coverAll(): void {
    if (this.revealed.size > 0) this.revealed.clear()
  }
}

export const annotationView = new AnnotationView()

/**
 * Registers view.hideAnnotations (H), view.memoryMode (Q) and
 * view.coverHighlights (Shift+Q, while in memory mode); `hasDoc` enables them.
 */
export function registerAnnotationViewCommands(
  hasDoc: () => boolean,
  view: AnnotationView = annotationView,
  commands: CommandRegistry = defaultCommands,
  keybindings: KeybindingRegistry = defaultKeybindings,
): () => void {
  const disposers = [
    commands.register({
      id: 'view.hideAnnotations',
      title: 'Hide annotations',
      run: () => {
        view.toggleHidden()
        // The status bar may be out of sight (fullscreen): say why the page looks bare.
        if (view.hidden) toasts.show('Annotations hidden. Press H to show them.')
      },
      enabled: hasDoc,
    }),
    bindShortcut(keybindings, 'view.hideAnnotations'),
    commands.register({
      id: 'view.memoryMode',
      title: 'Memory mode',
      run: () => {
        view.toggleMemory()
        if (view.memory) toasts.show('Memory mode: click a highlight to reveal it. Q to leave.')
      },
      enabled: hasDoc,
    }),
    bindShortcut(keybindings, 'view.memoryMode'),
    commands.register({
      id: 'view.coverHighlights',
      title: 'Cover highlights again',
      run: () => view.coverAll(),
      enabled: () => hasDoc() && view.memory,
    }),
    bindShortcut(keybindings, 'view.coverHighlights'),
  ]
  return () => disposers.forEach((d) => d())
}
