import { describe, expect, it } from 'vitest'
import { createEraserHandler, eraserTool } from '../../../src/tools/eraser'
import { annotationKinds } from '../../../src/core/registry/annotationKinds'
import { distToSegment } from '../../../src/core/geometry/hit'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Command } from '../../../src/core/session/history.svelte'
import type { Annotation, Point } from '../../../src/core/session/model'

// Minimal kinds: ink = horizontal line y=y0 from x=0..100; freetext = never erased.
annotationKinds.register({
  kind: 'ink',
  hitTest: (a: Annotation, p: Point, tol: number) => distToSegment(p, [0, (a as never as { y: number }).y], [100, (a as never as { y: number }).y]) <= tol,
} as never)
annotationKinds.register({ kind: 'freetext', hitTest: () => true } as never)
// shape = hit anywhere with x >= 200.
annotationKinds.register({ kind: 'shape', hitTest: (_a: Annotation, p: Point) => p[0] >= 200 } as never)
// image = hit everywhere (but never erased).
annotationKinds.register({ kind: 'image', hitTest: () => true } as never)

const stroke = (id: string, y: number) => ({ id, kind: 'ink', page: 0, y }) as unknown as Annotation
const text = { id: 't', kind: 'freetext', page: 0 } as Annotation

function setup(scale = 2, extra: Annotation[] = []) {
  const annos = [stroke('a', 10), stroke('b', 50), text, ...extra]
  const executed: Command[] = []
  let hidden: string[] = []
  let publishes = 0
  const ctx = {
    session: { store: { byPage: (p: number) => annos.filter((a) => a.page === p) } },
    execute: (c: Command) => executed.push(c),
    hidden: { get ids() { return new Set(hidden) }, set: (ids: Iterable<string>) => { publishes++; hidden = [...ids] } },
  } as unknown as ToolContext
  const ev = (x: number, y: number): PagePointerEvent => ({
    page: 0, pdf: [x, y], screen: [0, 0], vp: { scale } as never, native: {} as PointerEvent, toPdf: (a, b) => [a, b],
  })
  return { handler: createEraserHandler(ctx), ctx, executed, ev, hidden: () => hidden, publishes: () => publishes, annos }
}

describe('eraser', () => {
  it('is a single-instance tool without options', () => {
    expect(eraserTool).toMatchObject({ shortcut: 'E', allowMultipleInstances: false, Options: null })
  })

  it('hides strokes during the drag and deletes them in one command on up', () => {
    const { handler, executed, ev, hidden, annos } = setup()
    handler.onPointerDown!(ev(50, 10))
    expect(hidden()).toEqual(['a'])
    // Fast jump across stroke b: the segment is sampled, not just the end point.
    handler.onPointerMove!(ev(50, 90))
    expect(hidden().sort()).toEqual(['a', 'b'])
    expect(executed).toHaveLength(0)
    handler.onPointerUp!(ev(50, 90))
    expect(hidden()).toEqual([])
    expect(executed).toHaveLength(1)
    const removed: string[] = []
    executed[0].do({ remove: (id: string) => removed.push(id), byPage: (p: number) => annos.filter((a) => a.page === p) } as never)
    expect(removed.sort()).toEqual(['a', 'b'])
  })

  it('with the markerStrokes scope erases marker strokes only', () => {
    const ctxSetup = setup(2, [
      { ...stroke('m', 30), role: 'marker' } as Annotation,
      { ...stroke('p', 30), role: 'pen' } as Annotation,
      { id: 'h', kind: 'shape', page: 0 } as Annotation,
    ])
    const scoped = createEraserHandler(ctxSetup.ctx, 'markerStrokes')
    scoped.onPointerDown!(ctxSetup.ev(50, 30))
    scoped.onPointerMove!(ctxSetup.ev(250, 30))
    expect(ctxSetup.hidden()).toEqual(['m'])
  })

  it('uses a 6 screen px radius (3 pt at scale 2)', () => {
    const { handler, ev, hidden } = setup(2)
    handler.onPointerDown!(ev(50, 13.5)) // 3.5 pt away
    expect(hidden()).toEqual([])
    handler.onPointerMove!(ev(50, 12.5)) // 2.5 pt away
    expect(hidden()).toEqual(['a'])
  })

  it('never erases other kinds, and nothing hit means no command', () => {
    const { handler, executed, ev } = setup()
    handler.onPointerDown!(ev(500, 500))
    handler.onPointerUp!(ev(500, 500))
    expect(executed).toHaveLength(0)
  })

  it('erases shapes', () => {
    const shape = { id: 's', kind: 'shape', page: 0 } as Annotation
    const { handler, executed, ev, hidden } = setup(2, [shape])
    handler.onPointerDown!(ev(250, 500))
    expect(hidden()).toEqual(['s'])
    handler.onPointerUp!(ev(250, 500))
    expect(executed).toHaveLength(1)
  })

  it('never erases pasted images', () => {
    const image = { id: 'im', kind: 'image', page: 0 } as Annotation
    const { handler, executed, ev, hidden } = setup(2, [image])
    handler.onPointerDown!(ev(250, 500))
    handler.onPointerMove!(ev(50, 10))
    expect(hidden()).not.toContain('im')
    handler.onPointerUp!(ev(50, 10))
    expect(executed).toHaveLength(1)
    expect(hidden()).toEqual([])
  })

  it('cancel and deactivate clear hidden without deleting', () => {
    for (const end of ['onPointerCancel', 'onDeactivate'] as const) {
      const { handler, executed, ev, hidden } = setup()
      handler.onPointerDown!(ev(50, 10))
      expect(hidden()).toEqual(['a'])
      handler[end]!(ev(50, 10))
      expect(hidden()).toEqual([])
      expect(executed).toHaveLength(0)
    }
  })

  it('publishes the hidden set only when it grows', () => {
    const { handler, ev, hidden, publishes } = setup()
    handler.onPointerDown!(ev(50, 10))
    const afterDown = publishes()
    for (let x = 51; x < 60; x++) handler.onPointerMove!(ev(x, 30))
    expect(publishes()).toBe(afterDown)
    handler.onPointerMove!(ev(60, 50))
    expect(publishes()).toBe(afterDown + 1)
    expect(hidden().sort()).toEqual(['a', 'b'])
  })
})
