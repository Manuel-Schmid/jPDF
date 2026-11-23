import type { AnnotationStore } from './store.svelte'

export interface Command { label: string; do(s: AnnotationStore): void; undo(s: AnnotationStore): void }

interface Entry { cmd: Command; id: number }

/**
 * Undo/redo stack. Dirty-tracking uses a unique id per executed command (the
 * "state id" of a history position) rather than a counter, so undoing to the
 * clean point and then executing something else is correctly dirty.
 */
export class History {
  private stack = $state.raw<Entry[]>([])
  /** Number of applied entries in `stack`. */
  private index = $state(0)
  /** State id of position 0 (changes when the oldest entries are dropped). */
  private baseId = $state(0)
  private cleanId = $state(0)
  private seq = 0
  private _version = $state(0)

  constructor(private store: AnnotationStore, private limit = 200) {}

  get canUndo(): boolean { return this.index > 0 }
  get canRedo(): boolean { return this.index < this.stack.length }
  /** Increments on every execute/undo/redo. */
  get version(): number { return this._version }
  get isDirty(): boolean { return this.currentId() !== this.cleanId }
  /** Id of the current history position (for markClean of an earlier position). */
  get stateId(): number { return this.currentId() }

  execute(cmd: Command): void {
    cmd.do(this.store)
    const next = this.stack.slice(0, this.index)
    next.push({ cmd, id: ++this.seq })
    if (next.length > this.limit) {
      this.baseId = next[next.length - this.limit - 1].id
      next.splice(0, next.length - this.limit)
    }
    this.stack = next
    this.index = next.length
    this._version++
  }

  /**
   * Runs `cmd` and folds it into the newest applied step, which becomes
   * `merged` (undoing it undoes both). The step gets a new state id, so the
   * document is dirty even if the old step was the saved one. Steps after it
   * (redo) are dropped, as on execute. With nothing to undo it is execute(merged).
   */
  amend(cmd: Command, merged: Command): void {
    if (this.index === 0) return this.execute(merged)
    cmd.do(this.store)
    const next = this.stack.slice(0, this.index)
    next[next.length - 1] = { cmd: merged, id: ++this.seq }
    this.stack = next
    this._version++
  }

  undo(): boolean {
    if (this.index === 0) return false
    this.stack[this.index - 1].cmd.undo(this.store)
    this.index--
    this._version++
    return true
  }

  redo(): boolean {
    if (this.index >= this.stack.length) return false
    this.stack[this.index].cmd.do(this.store)
    this.index++
    this._version++
    return true
  }

  /** Forgets every step (nothing to undo or redo); the current state counts as saved. */
  reset(): void {
    this.stack = []
    this.index = 0
    this.baseId = ++this.seq
    this.cleanId = this.baseId
    this._version++
  }

  /** Marks the position `stateId` (default: the current one) as the saved state. */
  markClean(stateId: number = this.currentId()): void {
    this.cleanId = stateId
  }

  private currentId(): number {
    return this.index > 0 ? this.stack[this.index - 1].id : this.baseId
  }
}
