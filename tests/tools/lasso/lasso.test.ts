import { describe, expect, it } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../../src/annotations'
import { createLassoHandler, lassoTool } from '../../../src/tools/lasso'
import type { LassoPath, PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, Point, ShapeAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

// Page 200 x 100 pt at scale 2: screen = (2x, 2(100 - y)).
const vp = {
  scale: 2,
  rotation: 0,
  width: 400,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

function ev(pdf: Point, opts: { page?: number; shift?: boolean } = {}): PagePointerEvent {
  const [x, y] = vp.convertToViewportPoint(pdf[0], pdf[1])
  const native = { clientX: x, clientY: y, shiftKey: !!opts.shift } as PointerEvent
  return { page: opts.page ?? 0, pdf, screen: [x, y], vp, native, toPdf: () => pdf }
}

/** A filled square (hit anywhere inside), no border: bounds = rect. */
function sq(id: string, x: number, y: number, size = 10, page = 0): ShapeAnnotation {
  return {
    id, page, sourceRef: null, modifiedAt: 't', author: 'A', kind: 'shape', shape: 'rect',
    rect: [x, y, x + size, y + size], border: null, fill: { color: [0, 1, 0], opacity: 1 },
  }
}

const rectOf = (store: AnnotationStore, id: string) => (store.get(id) as ShapeAnnotation).rect

function setup(loaded: Annotation[]) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const state = {
    selection: [] as string[],
    previews: [] as readonly Annotation[],
    lasso: null as LassoPath | null,
    hidden: [] as string[],
    cursor: null as string | null,
  }
  const ctx = {
    session: { store, history },
    execute: (c: Parameters<History['execute']>[0]) => history.execute(c),
    selection: {
      get ids() {
        return state.selection
      },
      set: (ids: string[]) => void (state.selection = ids),
    },
    preview: { set: () => {} },
    pagePreviews: { set: (l: readonly Annotation[]) => void (state.previews = l) },
    lasso: { set: (l: LassoPath | null) => void (state.lasso = l) },
    hidden: {
      get ids() {
        return new Set(state.hidden)
      },
      set: (ids: Iterable<string>) => void (state.hidden = [...ids]),
    },
    cursor: { set: (c: string | null) => void (state.cursor = c) },
    textEdit: { set: () => {} },
  } as unknown as ToolContext
  return { store, history, state, h: createLassoHandler(ctx) }
}

/** A closed lasso through `points` (pointer down at the first, up at the last). */
function drawLasso(h: ReturnType<typeof createLassoHandler>, points: Point[], shift = false) {
  h.onPointerDown!(ev(points[0], { shift }))
  for (const p of points.slice(1)) h.onPointerMove!(ev(p, { shift }))
  h.onPointerUp!(ev(points.at(-1)!, { shift }))
}

const around = (x1: number, y1: number, x2: number, y2: number): Point[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]

describe('lasso tool', () => {
  it('is registered with group selection and the L shortcut', () => {
    expect(lassoTool.type).toBe('lasso')
    expect(lassoTool.shortcut).toBe('L')
    expect(setup([]).h.groupSelection).toBe(true)
  })

  it('selects the annotations the lasso surrounds, showing the outline while drawing', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20), sq('far', 150, 70)])
    t.h.onPointerDown!(ev([10, 10]))
    t.h.onPointerMove!(ev([80, 10]))
    t.h.onPointerMove!(ev([80, 40]))
    expect(t.state.lasso).toEqual({ page: 0, points: [[10, 10], [80, 10], [80, 40]] })
    t.h.onPointerMove!(ev([10, 40]))
    t.h.onPointerUp!(ev([10, 40]))
    expect(t.state.selection).toEqual(['a', 'b'])
    expect(t.state.lasso).toBeNull()
  })

  it('a press on empty space clears the selection; a click without a lasso selects nothing', () => {
    const t = setup([sq('a', 20, 20)])
    t.state.selection = ['a']
    t.h.onPointerDown!(ev([150, 80]))
    expect(t.state.selection).toEqual([])
    t.h.onPointerUp!(ev([150, 80]))
    expect(t.state.selection).toEqual([])
  })

  it('Shift+lasso adds to the selection', () => {
    const t = setup([sq('a', 20, 20), sq('b', 120, 20)])
    drawLasso(t.h, around(10, 10, 40, 40))
    drawLasso(t.h, around(110, 10, 140, 40), true)
    expect(t.state.selection).toEqual(['a', 'b'])
  })

  it('a click selects an annotation; Shift+click adds and removes', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    t.h.onPointerDown!(ev([25, 25]))
    t.h.onPointerUp!(ev([25, 25]))
    expect(t.state.selection).toEqual(['a'])
    t.h.onPointerDown!(ev([55, 25], { shift: true }))
    expect(t.state.selection).toEqual(['a', 'b'])
    t.h.onPointerDown!(ev([25, 25], { shift: true }))
    expect(t.state.selection).toEqual(['b'])
  })

  it('dragging a selected annotation moves the whole selection as one undo step', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20), sq('other', 150, 70)])
    drawLasso(t.h, around(10, 10, 80, 40))
    t.h.onPointerDown!(ev([25, 25]))
    t.h.onPointerMove!(ev([35, 30]))
    expect(t.state.hidden).toEqual(['a', 'b'])
    expect(t.state.cursor).toBe('move')
    expect(t.state.previews.map((a) => [a.id, (a as ShapeAnnotation).rect])).toEqual([
      ['a', [30, 25, 40, 35]],
      ['b', [60, 25, 70, 35]],
    ])
    t.h.onPointerUp!(ev([35, 30]))
    expect(rectOf(t.store, 'a')).toEqual([30, 25, 40, 35])
    expect(rectOf(t.store, 'b')).toEqual([60, 25, 70, 35])
    expect(rectOf(t.store, 'other')).toEqual([150, 70, 160, 80])
    expect(t.state.previews).toEqual([])
    expect(t.state.hidden).toEqual([])
    expect(t.state.selection).toEqual(['a', 'b'])
    t.history.undo()
    expect(rectOf(t.store, 'a')).toEqual([20, 20, 30, 30])
    expect(rectOf(t.store, 'b')).toEqual([50, 20, 60, 30])
  })

  it('a press inside the selection box between the annotations moves the group too', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    drawLasso(t.h, around(10, 10, 80, 40))
    t.h.onPointerDown!(ev([40, 25]))
    t.h.onPointerMove!(ev([40, 15]))
    t.h.onPointerUp!(ev([40, 15]))
    expect(rectOf(t.store, 'a')).toEqual([20, 10, 30, 20])
    expect(rectOf(t.store, 'b')).toEqual([50, 10, 60, 20])
  })

  it('keeps the group on the page when dragged past its edge', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    drawLasso(t.h, around(10, 10, 80, 40))
    t.h.onPointerDown!(ev([25, 25]))
    t.h.onPointerMove!(ev([25, -100]))
    t.h.onPointerUp!(ev([25, -100]))
    expect(rectOf(t.store, 'a')).toEqual([20, 0, 30, 10])
    expect(rectOf(t.store, 'b')).toEqual([50, 0, 60, 10])
  })

  it('dragging an unselected annotation selects and moves only it', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    t.state.selection = ['a']
    t.h.onPointerDown!(ev([55, 25]))
    expect(t.state.selection).toEqual(['b'])
    t.h.onPointerMove!(ev([65, 25]))
    t.h.onPointerUp!(ev([65, 25]))
    expect(rectOf(t.store, 'a')).toEqual([20, 20, 30, 30])
    expect(rectOf(t.store, 'b')).toEqual([60, 20, 70, 30])
  })

  it('a press below the drag threshold changes nothing', () => {
    const t = setup([sq('a', 20, 20)])
    t.h.onPointerDown!(ev([25, 25]))
    t.h.onPointerMove!(ev([25.5, 25]))
    t.h.onPointerUp!(ev([25.5, 25]))
    expect(t.history.canUndo).toBe(false)
  })

  it('never selects flattened annotations', () => {
    const t = setup([{ ...sq('flat', 20, 20), flattened: true }, sq('b', 50, 20)])
    drawLasso(t.h, around(10, 10, 80, 40))
    expect(t.state.selection).toEqual(['b'])
    t.h.onPointerDown!(ev([25, 25]))
    expect(t.state.selection).toEqual([])
  })

  it('only selects on the lasso page', () => {
    const t = setup([sq('a', 20, 20), sq('p1', 20, 20, 10, 1)])
    drawLasso(t.h, around(10, 10, 40, 40))
    expect(t.state.selection).toEqual(['a'])
  })

  it('cancel and deactivate drop the gesture; deactivate clears the selection', () => {
    const t = setup([sq('a', 20, 20)])
    t.h.onPointerDown!(ev([10, 10]))
    t.h.onPointerMove!(ev([50, 10]))
    t.h.onPointerCancel!(ev([50, 10]))
    expect(t.state.lasso).toBeNull()
    t.state.selection = ['a']
    t.h.onDeactivate!()
    expect(t.state.selection).toEqual([])
  })
})

describe('lasso tool: right-click', () => {
  it('on a member of the selection keeps the whole group for the menu', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    drawLasso(t.h, around(10, 10, 80, 40))
    expect(t.h.onContextMenu!(ev([55, 25]))).toBe(true)
    expect(t.state.selection).toEqual(['a', 'b'])
  })

  it('on another annotation selects just that one', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20), sq('c', 150, 70)])
    drawLasso(t.h, around(10, 10, 80, 40))
    expect(t.h.onContextMenu!(ev([155, 75]))).toBe(true)
    expect(t.state.selection).toEqual(['c'])
  })

  it('on blank space keeps the selection and opens the plain page menu', () => {
    const t = setup([sq('a', 20, 20)])
    t.state.selection = ['a']
    expect(t.h.onContextMenu!(ev([150, 80]))).toBe(false)
    expect(t.state.selection).toEqual(['a'])
  })
})
