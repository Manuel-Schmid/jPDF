import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPenHandler, type PenSettings } from '../../../src/tools/pen'
import { createFreehandHandler } from '../../../src/tools/marker/freehand'
import { HOLD_MS } from '../../../src/tools/shared/strokeCapture'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Annotation, InkAnnotation, Point } from '../../../src/core/session/model'
import type { Command } from '../../../src/core/session/history.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

function ev(pdf: Point, scale = 1, native: Partial<PointerEvent> = {}): PagePointerEvent {
  return {
    page: 0,
    pdf,
    screen: [0, 0],
    vp: { scale } as never,
    native: native as PointerEvent,
    toPdf: (x, y) => [x / 10, y / 10],
  }
}

function setup(pen: Partial<PenSettings> = {}) {
  const executed: Command[] = []
  const previews: (Annotation | null)[] = []
  const ctx = {
    execute: (c: Command) => executed.push(c),
    preview: { set: (a: Annotation | null) => previews.push(a) },
    session: { store: new AnnotationStore() },
  } as unknown as ToolContext
  const settings = { color: [0, 0, 0], width: 2, opacity: 1, holdStraight: true, ...pen } as PenSettings
  const handler = createPenHandler(ctx, () => settings)
  const committed = () => {
    const added: Annotation[] = []
    executed[0].do({ add: (a: Annotation) => added.push(a) } as never)
    return added as InkAnnotation[]
  }
  const lastPreview = () => (previews.at(-1) as InkAnnotation | null)?.strokes[0]
  return { executed, previews, handler, committed, lastPreview, settings }
}

describe('hold to straighten', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holding still mid-stroke straightens the preview and the saved stroke', () => {
    const { handler, committed, lastPreview } = setup()
    const pen = { pointerType: 'pen', pressure: 0.5 }
    handler.onPointerDown!(ev([0, 0], 1, pen))
    handler.onPointerMove!(ev([5, 3], 1, pen))
    handler.onPointerMove!(ev([20, 4], 1, pen))
    vi.advanceTimersByTime(HOLD_MS - 50)
    expect(lastPreview()).toHaveLength(3)
    vi.advanceTimersByTime(100) // the hold, then the next preview frame
    expect(lastPreview()).toEqual([[0, 0], [20, 4]])
    handler.onPointerUp!(ev([20, 4], 1, { ...pen, pressure: 0 }))
    const [a] = committed()
    // Saved like a Shift-straightened stroke: two points, no pressure.
    expect(a.strokes).toEqual([[[0, 0], [20, 4]]])
    expect(a).not.toHaveProperty('pressure')
  })

  it('moving on after the hold keeps it straight and moves its end point', () => {
    const { handler, committed, lastPreview } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([20, 0]))
    vi.advanceTimersByTime(HOLD_MS)
    handler.onPointerMove!(ev([25, 8]))
    handler.onPointerMove!(ev([30, 2]))
    vi.advanceTimersByTime(20)
    expect(lastPreview()).toEqual([[0, 0], [30, 2]])
    handler.onPointerUp!(ev([31, 2]))
    expect(committed()[0].strokes).toEqual([[[0, 0], [31, 2]]])
  })

  it('a stroke that keeps moving stays freehand, however long it takes', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(HOLD_MS - 100)
      handler.onPointerMove!(ev([i * 10, i % 2 ? 10 : 0]))
    }
    handler.onPointerUp!(ev([50, 10]))
    expect(committed()[0].strokes[0].length).toBeGreaterThan(2)
  })

  it('jitter within the tolerance still counts as holding still', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerMove!(ev([30, 0]))
    vi.advanceTimersByTime(200)
    handler.onPointerMove!(ev([32, 2])) // ~2.8 px off the resting point
    vi.advanceTimersByTime(HOLD_MS - 200)
    handler.onPointerUp!(ev([32, 2]))
    expect(committed()[0].strokes).toEqual([[[0, 0], [32, 2]]])
  })

  it('the tolerance is in screen pixels: zoomed in, a small drift restarts the hold', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0], 4))
    handler.onPointerMove!(ev([5, 5], 4))
    handler.onPointerMove!(ev([10, 0], 4))
    vi.advanceTimersByTime(200)
    handler.onPointerMove!(ev([12, 0], 4)) // 2 pt = 8 px at 400%
    vi.advanceTimersByTime(HOLD_MS - 200)
    handler.onPointerUp!(ev([12, 0], 4))
    expect(committed()[0].strokes[0].length).toBeGreaterThan(2)
  })

  it('pausing right after pressing down does not turn the stroke into a line', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([2, 1]))
    vi.advanceTimersByTime(HOLD_MS * 2)
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerMove!(ev([20, 0]))
    handler.onPointerUp!(ev([20, 0]))
    expect(committed()[0].strokes[0].length).toBeGreaterThan(2)
  })

  it('does nothing when turned off', () => {
    const { handler, committed } = setup({ holdStraight: false })
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerMove!(ev([20, 0]))
    vi.advanceTimersByTime(HOLD_MS * 2)
    handler.onPointerUp!(ev([20, 0]))
    expect(committed()[0].strokes).toEqual([[[0, 0], [10, 10], [20, 0]]])
  })

  it('reads the setting when the hold completes, and treats an absent one as on', () => {
    const { handler, committed, settings } = setup({ holdStraight: false })
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerMove!(ev([20, 0]))
    delete (settings as Partial<PenSettings>).holdStraight // saved before the setting existed
    vi.advanceTimersByTime(HOLD_MS)
    handler.onPointerUp!(ev([20, 0]))
    expect(committed()[0].strokes).toEqual([[[0, 0], [20, 0]]])
  })

  it('a finished or cancelled stroke leaves no pending hold behind', () => {
    for (const end of ['onPointerUp', 'onPointerCancel'] as const) {
      const { handler, previews } = setup()
      handler.onPointerDown!(ev([0, 0]))
      handler.onPointerMove!(ev([20, 0]))
      handler[end]!(ev([20, 0]))
      const n = previews.length
      vi.advanceTimersByTime(HOLD_MS * 2)
      expect(previews).toHaveLength(n)
      expect(previews.at(-1)).toBeNull()
    }
  })

  it('Shift on the pen also straightens', () => {
    const { handler, committed } = setup()
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerUp!(ev([20, 0], 1, { shiftKey: true }))
    expect(committed()[0].strokes).toEqual([[[0, 0], [20, 0]]])
  })

  it('the freehand marker straightens on hold too', () => {
    const executed: Command[] = []
    const ctx = {
      execute: (c: Command) => executed.push(c),
      preview: { set: () => {} },
      session: { store: new AnnotationStore() },
    } as unknown as ToolContext
    const handler = createFreehandHandler(ctx, () => ({
      mode: 'freehand', color: [1, 1, 0], opacity: 1, width: 12, holdStraight: true,
    }))
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([10, 10]))
    handler.onPointerMove!(ev([40, 0]))
    vi.advanceTimersByTime(HOLD_MS)
    handler.onPointerUp!(ev([40, 0]))
    const added: Annotation[] = []
    executed[0].do({ add: (a: Annotation) => added.push(a), all: () => [] } as never)
    expect((added[0] as InkAnnotation).strokes).toEqual([[[0, 0], [40, 0]]])
  })
})
