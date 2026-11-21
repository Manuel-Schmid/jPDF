import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPenHandler, penTool } from '../../../src/tools/pen'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Annotation, InkAnnotation, Point } from '../../../src/core/session/model'
import type { Command } from '../../../src/core/session/history.svelte'
import { settings as appSettings } from '../../../src/core/settings/settings.svelte'

function ev(pdf: Point, scale = 1, native: Partial<PointerEvent> = {}): PagePointerEvent {
  return {
    page: 2,
    pdf,
    screen: [0, 0],
    vp: { scale } as never,
    native: native as PointerEvent,
    toPdf: (x, y) => [x / 10, y / 10],
  }
}

function setup() {
  const executed: Command[] = []
  const previews: (Annotation | null)[] = []
  const added: Annotation[] = []
  const ctx = {
    execute: (c: Command) => executed.push(c),
    preview: { set: (a: Annotation | null) => previews.push(a) },
  } as unknown as ToolContext
  const handler = createPenHandler(ctx, () => ({ color: [0, 0, 1], width: 3, opacity: 0.5 }))
  const committed = () => {
    executed[0].do({ add: (a: Annotation) => added.push(a) } as never)
    return added as InkAnnotation[]
  }
  return { executed, previews, handler, committed }
}

describe('pen handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('default settings match the toolbar default', () => {
    expect(penTool.defaultSettings).toEqual({ color: [0.898, 0.224, 0.208], width: 1.5, opacity: 1 })
  })

  it('commits one simplified ink annotation on up', () => {
    const { executed, previews, handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 0], 1, { getCoalescedEvents: () => [] }))
    handler.onPointerMove!(ev([10, 0]))
    vi.advanceTimersByTime(50)
    expect(previews.some((p) => p !== null)).toBe(true)
    handler.onPointerUp!(ev([10, 0]))
    expect(executed).toHaveLength(1)
    expect(previews.at(-1)).toBeNull()
    const [a] = committed()
    expect(a).toMatchObject({
      page: 2,
      sourceRef: null,
      author: appSettings.data.author,
      kind: 'ink',
      role: 'pen',
      blend: 'normal',
      color: [0, 0, 1],
      width: 3,
      opacity: 0.5,
      strokes: [[[0, 0], [10, 0]]],
    })
    expect(a.id).toBeTruthy()
    expect(() => new Date(a.modifiedAt).toISOString()).not.toThrow()
  })

  it('uses coalesced events through toPdf', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    const co = [
      { clientX: 50, clientY: 0 },
      { clientX: 100, clientY: 100 },
    ] as PointerEvent[]
    handler.onPointerMove!(ev([10, 10], 1, { getCoalescedEvents: () => co }))
    handler.onPointerUp!(ev([10, 10]))
    expect(committed()[0].strokes[0]).toEqual([[0, 0], [5, 0], [10, 10]])
  })

  it('a click without moving still commits a single-point stroke', () => {
    const { executed, handler, committed } = setup()
    handler.onPointerDown!(ev([4, 4]))
    handler.onPointerUp!(ev([4, 4]))
    expect(executed).toHaveLength(1)
    expect(committed()[0].strokes).toEqual([[[4, 4]]])
  })

  it('mouse and touch strokes carry no pressure', () => {
    for (const pointerType of ['mouse', 'touch']) {
      const { handler, committed } = setup()
      handler.onPointerDown!(ev([0, 0], 1, { pointerType, pressure: 0.5 }))
      handler.onPointerMove!(ev([5, 5], 1, { pointerType, pressure: 0.5 }))
      handler.onPointerUp!(ev([10, 0], 1, { pointerType, pressure: 0 }))
      expect(committed()[0]).not.toHaveProperty('pressure')
    }
  })

  it('a pen stroke records its pressure per kept point, smoothed', () => {
    const { handler, committed, previews } = setup()
    const pen = (pressure: number, co: Partial<PointerEvent>[] = []) => ({
      pointerType: 'pen',
      pressure,
      getCoalescedEvents: () => co as PointerEvent[],
    })
    handler.onPointerDown!(ev([0, 0], 1, pen(0.1)))
    // Coalesced samples bring their own pressure (toPdf divides by 10).
    handler.onPointerMove!(ev([20, 0], 1, pen(0.1, [{ clientX: 100, clientY: 0, pressure: 0.9 }, { clientX: 200, clientY: 0, pressure: 0.1 }])))
    vi.advanceTimersByTime(50)
    expect((previews.find((p) => p) as InkAnnotation).pressure).toEqual([[0.1, 0.9, 0.1]])
    // The pen lifts with pressure 0 at a new position: that point keeps the last pressure.
    handler.onPointerUp!(ev([30, 0], 1, pen(0)))
    const [a] = committed()
    // Smoothed [0.1, 0.367, 0.367, 0.1]: the press at x=10 survives on a
    // straight line; x=20 lies on the width ramp from there and is dropped.
    expect(a.strokes[0]).toEqual([[0, 0], [10, 0], [30, 0]])
    expect(a.pressure).toHaveLength(1)
    ;[0.1, 1.1 / 3, 0.1].forEach((v, i) => expect(a.pressure![0][i]).toBeCloseTo(v))
  })

  it('a pen stroke drops points that change neither direction nor width', () => {
    const { handler, committed } = setup()
    const pen = { pointerType: 'pen', pressure: 0.5 }
    handler.onPointerDown!(ev([0, 0], 1, pen))
    handler.onPointerMove!(ev([5, 0], 1, pen))
    handler.onPointerMove!(ev([10, 0], 1, pen))
    handler.onPointerUp!(ev([10, 0], 1, { ...pen, pressure: 0 }))
    const [a] = committed()
    expect(a.strokes[0]).toEqual([[0, 0], [10, 0]])
    expect(a.pressure).toEqual([[0.5, 0.5]])
  })

  it('cancel and deactivate discard the stroke', () => {
    for (const end of ['onPointerCancel', 'onDeactivate'] as const) {
      const { executed, previews, handler } = setup()
      handler.onPointerDown!(ev([0, 0]))
      handler.onPointerMove!(ev([5, 5]))
      handler[end]!(ev([9, 9]))
      vi.advanceTimersByTime(50)
      expect(executed).toHaveLength(0)
      expect(previews.at(-1)).toBeNull()
    }
  })
})
