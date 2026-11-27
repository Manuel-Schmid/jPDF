import { describe, expect, it } from 'vitest'
import { createEraserHandler, eraserModeOf, eraserTool, type EraserMode } from '../../../src/tools/eraser'
import { annotationKinds } from '../../../src/core/registry/annotationKinds'
import { inkKind } from '../../../src/annotations/ink'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Command } from '../../../src/core/session/history.svelte'
import type { Annotation, InkAnnotation, Point } from '../../../src/core/session/model'
import type { ToolInstance } from '../../../src/core/settings/settings.svelte'

annotationKinds.register(inkKind)
// shape = hit anywhere with x >= 200.
annotationKinds.register({ kind: 'shape', hitTest: (_a: Annotation, p: Point) => p[0] >= 200 } as never)

const ink = (id: string, strokes: Point[][], extra: Partial<InkAnnotation> = {}): InkAnnotation => ({
  id, kind: 'ink', page: 0, sourceRef: null, modifiedAt: 'old', author: '',
  strokes, color: [0, 0, 0], width: 1, opacity: 1, blend: 'normal', role: 'pen', ...extra,
})

/** A horizontal stroke at height y from x=0 to 100, a point every 10 pt. */
const row = (y: number): Point[] => Array.from({ length: 11 }, (_, i) => [i * 10, y] as Point)

function setup(annos: Annotation[], mode: EraserMode = 'partial') {
  let store = annos.slice()
  const executed: Command[] = []
  let hidden: string[] = []
  let previews: readonly Annotation[] = []
  const ctx = {
    session: { store: { byPage: (p: number) => store.filter((a) => a.page === p) } },
    execute: (c: Command) => executed.push(c),
    hidden: { get ids() { return new Set(hidden) }, set: (ids: Iterable<string>) => { hidden = [...ids] } },
    pagePreviews: { set: (l: readonly Annotation[]) => { previews = l } },
  } as unknown as ToolContext
  // Scale 1: the eraser radius is 6 pt.
  const ev = (x: number, y: number): PagePointerEvent => ({
    page: 0, pdf: [x, y], screen: [0, 0], vp: { scale: 1 } as never, native: {} as PointerEvent, toPdf: (a, b) => [a, b],
  })
  // A store the commands run against, mirroring the list.
  const s = {
    byPage: (p: number) => store.filter((a) => a.page === p),
    get: (id: string) => store.find((a) => a.id === id),
    remove: (id: string) => { store = store.filter((a) => a.id !== id) },
    add: (a: Annotation, i?: number) => { store.splice(i ?? store.length, 0, a) },
    update: (id: string, a: Annotation) => { store = store.map((x) => (x.id === id ? a : x)) },
  }
  return {
    handler: createEraserHandler(ctx, 'all', () => mode),
    executed, ev, s,
    hidden: () => hidden, previews: () => previews, store: () => store,
  }
}

describe('partial eraser', () => {
  it('previews the cut without touching the store, then splits the stroke in one step on up', () => {
    const a = ink('a', [row(10)])
    const t = setup([a])
    t.handler.onPointerDown!(t.ev(50, 30))
    t.handler.onPointerMove!(t.ev(50, 10)) // straight down onto the stroke
    expect(t.hidden()).toEqual(['a'])
    expect(t.previews()).toHaveLength(1)
    expect((t.previews()[0] as InkAnnotation).strokes).toHaveLength(2)
    expect(t.store()[0]).toBe(a)
    expect(t.executed).toHaveLength(0)

    t.handler.onPointerUp!(t.ev(50, 10))
    expect(t.hidden()).toEqual([])
    expect(t.previews()).toEqual([])
    expect(t.executed).toHaveLength(1)
    t.executed[0].do(t.s as never)
    const after = t.store()[0] as InkAnnotation
    expect(after.id).toBe('a')
    expect(after.strokes).toHaveLength(2)
    // Cut 6 pt (eraser) + 0.5 pt (half the width) either side of x=50.
    expect(after.strokes[0].at(-1)![0]).toBeCloseTo(43.5)
    expect(after.strokes[1][0][0]).toBeCloseTo(56.5)
    expect(after.modifiedAt).not.toBe('old')
    t.executed[0].undo(t.s as never)
    expect(t.store()[0]).toBe(a)
  })

  it('deletes a stroke erased completely, and still erases other kinds whole', () => {
    const dot = ink('d', [[[5, 5], [8, 5]]])
    const shape = { id: 's', kind: 'shape', page: 0 } as Annotation
    const t = setup([dot, shape])
    t.handler.onPointerDown!(t.ev(6, 5))
    t.handler.onPointerMove!(t.ev(250, 5))
    expect(t.hidden().sort()).toEqual(['d', 's'])
    expect(t.previews()).toEqual([])
    t.handler.onPointerUp!(t.ev(250, 5))
    t.executed[0].do(t.s as never)
    expect(t.store()).toEqual([])
    t.executed[0].undo(t.s as never)
    expect(t.store().map((a) => a.id)).toEqual(['d', 's'])
  })

  it('drops specks shorter than the eraser', () => {
    // Erasing at x=10 trims the left end: [0..3.5] is left, shorter than 6 pt.
    const t = setup([ink('a', [row(0)])])
    t.handler.onPointerDown!(t.ev(10, 0))
    t.handler.onPointerUp!(t.ev(10, 0))
    t.executed[0].do(t.s as never)
    const strokes = (t.store()[0] as InkAnnotation).strokes
    expect(strokes).toHaveLength(1)
    expect(strokes[0][0][0]).toBeCloseTo(16.5)
  })

  it('splits pressures with the strokes', () => {
    const t = setup([ink('a', [row(0)], { pressure: [row(0).map(() => 0.5)] })])
    t.handler.onPointerDown!(t.ev(50, 0))
    t.handler.onPointerUp!(t.ev(50, 0))
    t.executed[0].do(t.s as never)
    const after = t.store()[0] as InkAnnotation
    expect(after.pressure!.map((p) => p.length)).toEqual(after.strokes.map((s) => s.length))
  })

  it('in whole-stroke mode erases the annotation whole', () => {
    const t = setup([ink('a', [row(10)])], 'stroke')
    t.handler.onPointerDown!(t.ev(50, 10))
    t.handler.onPointerUp!(t.ev(50, 10))
    t.executed[0].do(t.s as never)
    expect(t.store()).toEqual([])
  })

  it('misses leave no command', () => {
    const t = setup([ink('a', [row(10)])])
    t.handler.onPointerDown!(t.ev(50, 50))
    t.handler.onPointerUp!(t.ev(50, 50))
    expect(t.executed).toEqual([])
  })
})

describe('eraser mode setting', () => {
  it('defaults to whole strokes', () => {
    expect(eraserTool.defaultSettings).toEqual({ mode: 'stroke' })
  })

  it('is read from the toolbar eraser for the right-button and pen erasers', () => {
    const inst = (type: string, settings: unknown): ToolInstance => ({ instanceId: type, type, settings })
    expect(eraserModeOf([inst('pen', { mode: 'partial' }), inst('eraser', { mode: 'partial' })])).toBe('partial')
    expect(eraserModeOf([inst('eraser', {})])).toBe('stroke') // older saved settings
    expect(eraserModeOf([])).toBe('stroke')
  })
})
