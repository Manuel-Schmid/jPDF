import { untrack } from 'svelte'
import type { ToolContext, ToolDefinition, ToolHandler } from '../registry/tools'
import { isEditable } from '../session/model'
import type { DocumentSession } from '../session/session.svelte'
import { SessionToolState } from '../session/toolState.svelte'
import type { ToolInstance } from '../settings/settings.svelte'

export interface ActiveToolLike {
  def: ToolDefinition
  instance: ToolInstance
}

export { SessionToolState }

/**
 * Where the active tool hands over (see ToolDefinition.defaultLocked):
 * `afterUse` runs after each command the tool's handler executes (an unlocked
 * tool then switches to the select tool), `exit` when it asks to leave
 * (ToolContext.exit). Neither runs for the temporary eraser or for a handler
 * that is no longer the active one (e.g. a text box committed on deactivation).
 */
export interface ToolHandover {
  afterUse(): void
  exit(): void
}

/**
 * Temporary eraser (hold the right mouse button): a handler created next to
 * the active tool's while `enabledFor(active tool)` is true (`null` = no tool).
 * It may depend on the tool's settings (the marker erases only in freehand
 * mode); the eraser follows settings changes without recreating the tool.
 */
export interface TemporaryEraserOptions {
  create(ctx: ToolContext): ToolHandler
  enabledFor(active: ActiveToolLike | null): boolean
}

/**
 * Owns the active tool's ToolHandler. The handler is created (with a
 * ToolContext for the active session) whenever the active instance or the
 * session changes; the previous handler gets onDeactivate. Settings changes
 * reach the handler through its live settings getter, without recreating it.
 * Overlays forward pointer input to `handler`, and right-button drags to
 * `eraser` (see TemporaryEraserOptions); both share the session's tool state.
 */
export class ToolRouter {
  handler: ToolHandler | null = $state.raw(null)
  /** Temporary right-button eraser for the active session; null when disabled. */
  eraser: ToolHandler | null = $state.raw(null)
  /**
   * Eraser for the pen's eraser end: like `eraser`, but present with every
   * tool (the eraser end always erases); null without a session or without
   * TemporaryEraserOptions.
   */
  penEraser: ToolHandler | null = $state.raw(null)

  readonly cursor: string | undefined = $derived.by(() => {
    const a = this.getActive()
    const session = this.getSession()
    const override = session ? this.stateOf(session).cursor : null
    return override ?? a?.def.cursor?.(a.instance.settings)
  })

  private states = new WeakMap<DocumentSession, SessionToolState>()
  private key: { instanceId: string | undefined; session: DocumentSession; erasing: boolean } | null = null

  constructor(
    private getActive: () => ActiveToolLike | null,
    private getSession: () => DocumentSession | null,
    private temporaryEraser?: TemporaryEraserOptions,
    private handover?: ToolHandover,
  ) {}

  /**
   * The session's tool state. Real sessions own one from construction (see
   * SessionToolState for why it must not be created lazily by a reader); the
   * lazy fallback only serves minimal session stand-ins.
   */
  stateOf(session: DocumentSession): SessionToolState {
    if (session.toolState) return session.toolState
    let s = this.states.get(session)
    if (!s) {
      s = new SessionToolState()
      this.states.set(session, s)
    }
    return s
  }

  /** Brings `handler` (and the temporary eraser) in line with the active tool and session. */
  sync(): void {
    const active = this.getActive()
    const session = this.getSession()
    const instanceId = active?.instance.instanceId
    // Read reactively: may depend on the tool's settings.
    const erasing = !!session && !!this.temporaryEraser?.enabledFor(active)
    if (this.key && this.key.instanceId === instanceId && this.key.session === session) {
      if (this.key.erasing !== erasing) untrack(() => this.setEraser(session, erasing))
      return
    }
    untrack(() => {
      this.deactivate()
      if (!session) return
      this.key = { instanceId, session, erasing: false }
      if (active && instanceId) {
        this.handler = active.def.createHandler(this.contextFor(session, true), this.settingsGetter(active.instance))
      }
      this.setEraser(session, erasing)
      this.penEraser = this.temporaryEraser ? this.temporaryEraser.create(this.contextFor(session)) : null
    })
  }

  /** Creates or drops the temporary eraser without touching the tool's handler. */
  private setEraser(session: DocumentSession | null, on: boolean): void {
    if (!this.key) return
    this.key.erasing = on
    const old = this.eraser
    this.eraser = on && session && this.temporaryEraser ? this.temporaryEraser.create(this.contextFor(session)) : null
    if (old) {
      try {
        old.onDeactivate?.()
      } catch (e) {
        console.error('Tool deactivation failed', e)
      }
    }
  }

  /** Keeps `handler` in sync reactively until the returned stop function is called. */
  start(): () => void {
    this.sync()
    const stop = $effect.root(() => {
      $effect(() => this.sync())
      $effect(() => this.pruneSelection())
    })
    return () => {
      stop()
      untrack(() => this.deactivate())
    }
  }

  /** Drops selected ids whose annotation is gone (undo, redo, eraser, delete) or flattened. */
  private pruneSelection(): void {
    const session = this.getSession()
    if (!session) return
    const state = this.stateOf(session)
    const alive = state.selection.filter((id) => {
      const a = session.store.get(id)
      return a !== undefined && isEditable(a)
    })
    if (alive.length !== state.selection.length) state.selection = alive
  }

  private deactivate(): void {
    const olds = [this.handler, this.eraser, this.penEraser]
    const oldSession = this.key?.session
    this.handler = null
    this.eraser = null
    this.penEraser = null
    this.key = null
    for (const old of olds) {
      if (!old) continue
      try {
        old.onDeactivate?.()
      } catch (e) {
        console.error('Tool deactivation failed', e)
      }
    }
    // An uncommitted preview must not outlive its tool.
    if (oldSession) {
      const state = this.stateOf(oldSession)
      state.preview = null
      state.pagePreviews = []
      state.lasso = null
      state.hidden = new Set()
      state.cursor = null
      state.textEdit = null
      state.crossDrag = null
      state.hint = null
    }
  }

  private settingsGetter(instance: ToolInstance): () => unknown {
    const id = instance.instanceId
    let last = instance.settings
    return () => {
      const a = this.getActive()
      if (a && a.instance.instanceId === id) last = a.instance.settings
      return last
    }
  }

  /** `primary`: the context of the active tool's own handler, whose commands count as uses (see ToolHandover). */
  private contextFor(session: DocumentSession, primary = false): ToolContext {
    const state = this.stateOf(session)
    const key = this.key
    // Deactivation clears the key before onDeactivate runs, so a handler's last commit hands over nothing.
    const current = () => primary && key !== null && this.key === key
    return {
      session,
      execute: (c) => {
        session.history.execute(c)
        if (current()) this.handover?.afterUse()
      },
      exit: () => {
        if (current()) this.handover?.exit()
      },
      selection: {
        get ids() {
          return state.selection
        },
        set: (ids) => {
          state.selection = ids
        },
      },
      preview: {
        set: (a) => {
          state.preview = a
        },
      },
      pagePreviews: {
        set: (list) => {
          state.pagePreviews = list
        },
      },
      lasso: {
        set: (l) => {
          state.lasso = l
        },
      },
      hidden: {
        get ids() {
          return state.hidden
        },
        set: (ids) => {
          state.hidden = new Set(ids)
        },
      },
      cursor: {
        set: (c) => {
          state.cursor = c
        },
      },
      textEdit: {
        set: (e) => {
          state.textEdit = e
        },
      },
      pages: {
        frame: (page) => state.frames.get(page)?.() ?? null,
      },
      crossDrag: {
        set: (d) => {
          state.crossDrag = d
        },
      },
      hint: {
        set: (h) => {
          if (h?.page !== state.hint?.page || h?.text !== state.hint?.text) state.hint = h
        },
      },
    }
  }
}
