import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkerHandler, markerTool, straightLine } from '../../../src/tools/marker'
import { createFreehandHandler } from '../../../src/tools/marker/freehand'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Annotation, InkAnnotation, Point } from '../../../src/core/session/model'
import type { Command } from '../../../src/core/session/history.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { settings as appSettings } from '../../../src/core/settings/settings.svelte'

function ev(pdf: Point, native: Partial<PointerEvent> = {}): PagePointerEvent {
  return {
    page: 1,
    pdf,
    screen: [0, 0],
    vp: { scale: 1 } as never,
    native: native as PointerEvent,
    toPdf: (x, y) => [x / 10, y / 10],
  }
}

function setup(make: typeof createFreehandHandler = createFreehandHandler) {
  const executed: Command[] = []
  const previews: (Annotation | null)[] = []
  const added: Annotation[] = []
  const ctx = {
    execute: (c: Command) => executed.push(c),
    preview: { set: (a: Annotation | null) => previews.push(a) },
    session: { store: new AnnotationStore() },
  } as unknown as ToolContext
  const handler = make(ctx, () => ({ mode: 'freehand', color: [1, 0.9, 0], opacity: 0.4, width: 14 }))
  const committed = () => {
    executed[0].do({ add: (a: Annotation) => added.push(a) } as never)
    return added as InkAnnotation[]
  }
  return { executed, previews, handler, committed }
}

describe('straightLine', () => {
  it('returns exactly two points', () => {
    expect(straightLine([1, 2], [30, 40])).toEqual([[1, 2], [30, 40]])
  })
})

describe('marker freehand handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('default settings match the toolbar default', () => {
    expect(markerTool.defaultSettings).toEqual({ mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12 })
  })

  it('commits ink with role marker and blend multiply', () => {
    const { executed, handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 5]))
    handler.onPointerMove!(ev([10, 0]))
    handler.onPointerUp!(ev([10, 0]))
    expect(executed).toHaveLength(1)
    expect(committed()[0]).toMatchObject({
      kind: 'ink',
      role: 'marker',
      blend: 'multiply',
      color: [1, 0.9, 0],
      width: 14,
      opacity: 0.4,
      page: 1,
      sourceRef: null,
      author: appSettings.data.author,
    })
  })

  it('Shift during the drag yields a 2-point stroke and straight preview', () => {
    const { previews, handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 5]))
    handler.onPointerMove!(ev([8, 20], { shiftKey: true }))
    vi.advanceTimersByTime(50)
    expect((previews.at(-1) as InkAnnotation).strokes[0]).toEqual([[0, 0], [8, 20]])
    handler.onPointerMove!(ev([10, 3])) // shift released, still straight
    handler.onPointerUp!(ev([12, 4]))
    expect(committed()[0].strokes).toEqual([[[0, 0], [12, 4]]])
  })

  it('Shift only on pointer up also straightens', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 5]))
    handler.onPointerMove!(ev([6, 9]))
    handler.onPointerUp!(ev([10, 10], { shiftKey: true }))
    expect(committed()[0].strokes).toEqual([[[0, 0], [10, 10]]])
  })

  it('cancel and deactivate discard the stroke', () => {
    for (const end of ['onPointerCancel', 'onDeactivate'] as const) {
      const { executed, previews, handler } = setup(createMarkerHandler)
      handler.onPointerDown!(ev([0, 0]))
      handler.onPointerMove!(ev([5, 5]))
      handler[end]!(ev([9, 9]))
      vi.advanceTimersByTime(50)
      expect(executed).toHaveLength(0)
      expect(previews.at(-1)).toBeNull()
    }
  })

  it('marker handler in freehand mode draws freehand', () => {
    const { handler, committed } = setup(createMarkerHandler)
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 5]))
    handler.onPointerUp!(ev([10, 0]))
    expect(committed()[0]).toMatchObject({ role: 'marker', blend: 'multiply' })
  })
})
