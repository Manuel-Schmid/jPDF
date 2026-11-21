import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext, ToolHandler } from '../../../src/core/registry/tools'
import type { Annotation } from '../../../src/core/session/model'
import type { DocumentSession } from '../../../src/core/session/session.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { ToolRouter } from '../../../src/core/viewer/toolRouting.svelte'
import { ActiveTool } from '../../../src/toolbar/activeTool.svelte'
import { fakeSetup, fakeTool } from '../../toolbar/fakeTools'

function fakeSession(id: string) {
  return { id, history: { execute: vi.fn() }, store: new AnnotationStore() } as unknown as DocumentSession
}

const anno = (page: number) => ({ id: 'x', page, kind: 'ink' }) as Annotation

function setup() {
  const s = fakeSetup([
    { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
    { instanceId: 'p2', type: 'pen', settings: { width: 5 } },
    { instanceId: 'x1', type: 'future', settings: {} },
  ])
  const created: { ctx: ToolContext; settings: () => unknown; handler: Required<Pick<ToolHandler, 'onDeactivate'>> }[] = []
  // Replace pen with a spying fake.
  const registry = s.registry
  const pen = registry.get('pen')
  pen.createHandler = (ctx, settings) => {
    const handler = { onDeactivate: vi.fn() }
    created.push({ ctx, settings, handler })
    return handler
  }
  const active = new ActiveTool(s.store, registry)
  let session: DocumentSession | null = fakeSession('s1')
  const router = new ToolRouter(() => active.current, () => session)
  return {
    ...s, active, router, created,
    setSession: (x: DocumentSession | null) => (session = x),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ActiveTool', () => {
  it('pairs the active instance with its definition', () => {
    const { active, store } = setup()
    expect(active.current?.def.type).toBe('pen')
    expect(active.current?.instance.instanceId).toBe('p1')
    store.setActive('x1')
    expect(active.current).toBeNull()
  })
})

describe('ToolRouter', () => {
  it('creates a handler for the active tool with live settings', () => {
    const { router, created, store } = setup()
    router.sync()
    expect(created).toHaveLength(1)
    expect(router.handler).toBe(created[0].handler)
    expect(created[0].settings()).toEqual({ width: 2 })
    store.updateSettings('p1', { width: 7 })
    expect(created[0].settings()).toEqual({ width: 7 })
    // Settings changes do not recreate the handler.
    router.sync()
    expect(created).toHaveLength(1)
  })

  it('switching instance deactivates the old handler and creates a new one', () => {
    const { router, created, store } = setup()
    router.sync()
    store.setActive('p2')
    router.sync()
    expect(created[0].handler.onDeactivate).toHaveBeenCalledOnce()
    expect(created).toHaveLength(2)
    expect(created[1].settings()).toEqual({ width: 5 })
  })

  it('no session or an unregistered active tool means no handler', () => {
    const { router, created, store, setSession } = setup()
    setSession(null)
    router.sync()
    expect(router.handler).toBeNull()
    setSession(fakeSession('s2'))
    router.sync()
    expect(router.handler).not.toBeNull()
    store.setActive('x1')
    router.sync()
    expect(router.handler).toBeNull()
    expect(created[0].handler.onDeactivate).toHaveBeenCalledOnce()
  })

  it('context executes on the session history and keeps preview and selection per session', () => {
    const { router, created, setSession } = setup()
    router.sync()
    const ctx = created[0].ctx
    const s1 = ctx.session
    const cmd = { label: 'x', do() {}, undo() {} }
    ctx.execute(cmd)
    expect(s1.history.execute).toHaveBeenCalledWith(cmd)

    ctx.preview.set(anno(3))
    ctx.selection.set(['a', 'b'])
    expect(ctx.selection.ids).toEqual(['a', 'b'])
    expect(router.stateOf(s1).preview?.page).toBe(3)

    const s2 = fakeSession('s2')
    setSession(s2)
    router.sync()
    expect(created[0].handler.onDeactivate).toHaveBeenCalledOnce()
    expect(created[1].ctx.session).toBe(s2)
    expect(created[1].ctx.selection.ids).toEqual([])
    // The old session's selection survives, its uncommitted preview does not.
    expect(router.stateOf(s1).selection).toEqual(['a', 'b'])
    expect(router.stateOf(s1).preview).toBeNull()
  })

  it('start() follows the active tool reactively; stop deactivates', () => {
    const { router, created, store } = setup()
    const stop = router.start()
    expect(created).toHaveLength(1)
    store.setActive('p2')
    flushSync()
    expect(created).toHaveLength(2)
    stop()
    expect(created[1].handler.onDeactivate).toHaveBeenCalledOnce()
    expect(router.handler).toBeNull()
  })

  it('start() prunes selected ids whose annotation no longer exists', () => {
    const { router, setSession } = setup()
    const session = fakeSession('s1')
    setSession(session)
    const a = { id: 'a', page: 0, kind: 'ink' } as Annotation
    session.store.add(a)
    const stop = router.start()
    const state = router.stateOf(session)
    state.selection = ['a']
    flushSync()
    expect(state.selection).toEqual(['a'])
    session.store.remove('a') // undo, eraser, delete elsewhere
    flushSync()
    expect(state.selection).toEqual([])
    stop()
  })

  it('hidden ids and the cursor override are per-session and cleared when the tool changes', () => {
    const { router, created, store } = setup()
    router.sync()
    const ctx = created[0].ctx
    ctx.hidden.set(['a', 'b'])
    ctx.cursor.set('grabbing')
    expect([...ctx.hidden.ids]).toEqual(['a', 'b'])
    expect(router.cursor).toBe('grabbing')
    store.setActive('p2')
    router.sync()
    expect(router.stateOf(ctx.session).hidden.size).toBe(0)
    expect(router.cursor).toBeUndefined()
  })

  it('exposes mounted page frames and cross-page drag state, cleared when the tool changes', () => {
    const { router, created, store } = setup()
    router.sync()
    const ctx = created[0].ctx
    const state = router.stateOf(ctx.session)
    const frame = { vp: {} as never, origin: [10, 20] as [number, number] }
    state.frames.set(3, () => frame)
    expect(ctx.pages!.frame(3)).toBe(frame)
    expect(ctx.pages!.frame(4)).toBeNull()
    ctx.crossDrag!.set({ page: 3 })
    expect(state.crossDrag).toEqual({ page: 3 })
    store.setActive('p2')
    router.sync()
    expect(state.crossDrag).toBeNull()
  })

  it('exposes the tool cursor', () => {
    const { router, registry, store } = setup()
    registry.get('pen').cursor = (s: { width: number }) => `cell-${s.width}`
    expect(router.cursor).toBe('cell-2')
    store.updateSettings('p1', { width: 4 })
    expect(router.cursor).toBe('cell-4')
    store.setActive('x1')
    expect(router.cursor).toBeUndefined()
    registry.register(fakeTool('plain'))
    store.addInstance('plain')
    store.setActive(store.data.toolbar.at(-1)!.instanceId)
    expect(router.cursor).toBeUndefined()
  })

  it('keeps a temporary eraser handler for the tools enabledFor allows, recreated with the tool', () => {
    const s = fakeSetup([
      { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
      { instanceId: 'h1', type: 'hand', settings: {} },
      { instanceId: 'x1', type: 'future', settings: {} },
    ])
    const active = new ActiveTool(s.store, s.registry)
    const session = fakeSession('s1')
    const erasers: { ctx: ToolContext; handler: { onDeactivate: ReturnType<typeof vi.fn> } }[] = []
    const router = new ToolRouter(() => active.current, () => session, {
      create: (ctx) => {
        const handler = { onDeactivate: vi.fn() }
        erasers.push({ ctx, handler })
        return handler
      },
      enabledFor: (a) => a?.def.type !== 'hand',
    })
    router.sync()
    expect(router.eraser).toBe(erasers[0].handler)
    expect(erasers[0].ctx.session).toBe(session)
    // Shares the session's hidden set with the active tool.
    erasers[0].ctx.hidden.set(['a'])
    expect([...router.stateOf(session).hidden]).toEqual(['a'])

    s.store.setActive('h1')
    router.sync()
    expect(erasers[0].handler.onDeactivate).toHaveBeenCalledOnce()
    expect(router.eraser).toBeNull()

    // No tool at all (unregistered): enabledFor decides (here: erase).
    s.store.setActive('x1')
    router.sync()
    expect(router.handler).toBeNull()
    expect(router.eraser).not.toBeNull()
    expect(erasers.some((e) => e.handler === router.eraser)).toBe(true)
  })

  it('keeps a pen eraser (eraser end) with every tool, recreated with the tool', () => {
    const s = fakeSetup([
      { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
      { instanceId: 'h1', type: 'hand', settings: {} },
    ])
    const active = new ActiveTool(s.store, s.registry)
    let session: DocumentSession | null = fakeSession('s1')
    const erasers: { ctx: ToolContext; handler: { onDeactivate: ReturnType<typeof vi.fn> } }[] = []
    const router = new ToolRouter(() => active.current, () => session, {
      create: (ctx) => {
        const handler = { onDeactivate: vi.fn() }
        erasers.push({ ctx, handler })
        return handler
      },
      enabledFor: (a) => a?.def.type !== 'hand',
    })
    router.sync()
    const first = router.penEraser
    expect(first).not.toBeNull()
    expect(first).not.toBe(router.eraser)
    expect(erasers.find((e) => e.handler === first)!.ctx.session).toBe(session)

    // The hand has no right-button eraser, but the eraser end still erases.
    s.store.setActive('h1')
    router.sync()
    expect(router.eraser).toBeNull()
    expect(router.penEraser).not.toBeNull()
    expect(router.penEraser).not.toBe(first)
    expect(erasers.find((e) => e.handler === first)!.handler.onDeactivate).toHaveBeenCalledOnce()

    session = null
    router.sync()
    expect(router.penEraser).toBeNull()
  })

  it('hands over after each command of the active tool, but not for the eraser or a deactivated handler', () => {
    const s = fakeSetup([
      { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
      { instanceId: 'h1', type: 'hand', settings: {} },
    ])
    const active = new ActiveTool(s.store, s.registry)
    const session = fakeSession('s1')
    const contexts: ToolContext[] = []
    s.registry.get('pen').createHandler = (ctx) => {
      contexts.push(ctx)
      return {}
    }
    let eraserCtx: ToolContext | null = null
    const handover = { afterUse: vi.fn(), exit: vi.fn() }
    const router = new ToolRouter(() => active.current, () => session, {
      create: (ctx) => {
        eraserCtx = ctx
        return {}
      },
      enabledFor: () => true,
    }, handover)
    router.sync()
    const cmd = { label: 'x', do: () => {}, undo: () => {} }
    contexts[0].execute(cmd)
    expect(session.history.execute).toHaveBeenCalledWith(cmd)
    expect(handover.afterUse).toHaveBeenCalledOnce()
    contexts[0].exit!()
    expect(handover.exit).toHaveBeenCalledOnce()

    // Right-button erasing is not a use of the active tool.
    eraserCtx!.execute(cmd)
    eraserCtx!.exit!()
    expect(handover.afterUse).toHaveBeenCalledOnce()
    expect(handover.exit).toHaveBeenCalledOnce()

    // A commit after the tool changed (e.g. a text box committed on deactivation) hands over nothing.
    s.store.setActive('h1')
    router.sync()
    contexts[0].execute(cmd)
    contexts[0].exit!()
    expect(session.history.execute).toHaveBeenCalledTimes(3)
    expect(handover.afterUse).toHaveBeenCalledOnce()
    expect(handover.exit).toHaveBeenCalledOnce()
  })

  it('turns the temporary eraser on and off when the active tool\'s settings change (marker mode)', () => {
    const s = fakeSetup([{ instanceId: 'p1', type: 'pen', settings: { width: 2 } }])
    const active = new ActiveTool(s.store, s.registry)
    const session = fakeSession('s1')
    const tool = vi.fn()
    s.registry.get('pen').createHandler = () => {
      tool()
      return {}
    }
    const router = new ToolRouter(() => active.current, () => session, {
      create: () => ({ onDeactivate: vi.fn() }),
      enabledFor: (a) => ((a?.instance.settings as { width?: number }).width ?? 0) > 3,
    })
    router.sync()
    expect(router.eraser).toBeNull()
    s.store.updateSettings('p1', { width: 5 })
    router.sync()
    expect(router.eraser).not.toBeNull()
    s.store.updateSettings('p1', { width: 1 })
    router.sync()
    expect(router.eraser).toBeNull()
    // The tool's own handler is not recreated by these settings changes.
    expect(tool).toHaveBeenCalledOnce()
  })

  it('has no temporary eraser without the option or without a session', () => {
    const { router, setSession } = setup()
    router.sync()
    expect(router.eraser).toBeNull()
    expect(router.penEraser).toBeNull()
    setSession(null)
    router.sync()
    expect(router.eraser).toBeNull()
    expect(router.penEraser).toBeNull()
  })
})
