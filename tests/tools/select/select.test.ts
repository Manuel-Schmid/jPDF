import { describe, expect, it } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../../src/annotations'
import { createSelectHandler, selectTool } from '../../../src/tools/select'
import { annotationKinds } from '../../../src/core/registry/annotationKinds'
import type { PagePointerEvent, TextEdit, ToolContext } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, FreeTextAnnotation, ImageAnnotation, InkAnnotation, Point, ShapeAnnotation } from '../../../src/core/session/model'
import { ALL_HANDLES, handlesFor } from '../../../src/tools/select/handles'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { boxHeight, layoutLines, minBoxWidth, pageBoxRect } from '../../../src/core/geometry/textLayout'

// Page 200 x 100 pt at scale 2: screen = (2x, 2(100 - y)).
const vp = {
  scale: 2,
  rotation: 0,
  width: 400,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

// /Rotate 90 at scale 2: screen right = +y, down = +x.
const vp90 = {
  scale: 2,
  rotation: 90,
  width: 200,
  height: 400,
  convertToViewportPoint: (x: number, y: number) => [y * 2, x * 2],
  convertToPdfPoint: (x: number, y: number) => [y / 2, x / 2],
} as unknown as PageViewport

let clock = 0
let currentVp = vp
/** Client y of each page's top: pages are 200px tall and 16px apart (page left at client x 0). */
const pageTop = (page: number) => page * 216
function ev(pdf: Point, page = 0): PagePointerEvent {
  const [x, y] = currentVp.convertToViewportPoint(pdf[0], pdf[1])
  const native = { timeStamp: clock, clientX: x, clientY: y + pageTop(page) } as PointerEvent
  return { page, pdf, screen: [x, y], vp: currentVp, native, toPdf: () => pdf }
}

const base = { page: 0, sourceRef: null, modifiedAt: '2026-01-01T00:00:00Z', author: 'A' }

function box(id: string, rect: FreeTextAnnotation['rect'], text = 'hi'): FreeTextAnnotation {
  return {
    ...base, id, kind: 'freetext', rect, text, lines: [text], fontSize: 10,
    textColor: [0, 0, 0], background: null,
  }
}

function ink(id: string, strokes: Point[][], width = 2): InkAnnotation {
  return { ...base, id, kind: 'ink', strokes, color: [1, 0, 0], width, opacity: 1, blend: 'normal', role: 'pen' }
}

const rectOf = (store: AnnotationStore, id: string) => (store.get(id) as FreeTextAnnotation).rect

function setup(loaded: Annotation[], pageCount = 1) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const session = { store, history, pendingEdit: null as (() => void) | null }
  const state = {
    selection: [] as string[],
    preview: null as Annotation | null,
    hidden: [] as string[],
    cursor: null as string | null,
    edit: null as TextEdit | null,
    crossDrag: null as { page: number; at?: number } | null,
  }
  const ctx = {
    session,
    execute: (c: Parameters<History['execute']>[0]) => history.execute(c),
    selection: {
      get ids() {
        return state.selection
      },
      set: (ids: string[]) => void (state.selection = ids),
    },
    preview: { set: (a: Annotation | null) => void (state.preview = a) },
    hidden: {
      get ids() {
        return new Set(state.hidden)
      },
      set: (ids: Iterable<string>) => void (state.hidden = [...ids]),
    },
    cursor: { set: (c: string | null) => void (state.cursor = c) },
    textEdit: { set: (e: TextEdit | null) => void (state.edit = e) },
    pages: { frame: (page: number) => (page >= 0 && page < pageCount ? { vp: currentVp, origin: [0, pageTop(page)] } : null) },
    crossDrag: { set: (d: { page: number; at?: number } | null) => void (state.crossDrag = d) },
  } as unknown as ToolContext
  const h = createSelectHandler(ctx)
  const drag = (from: Point, ...to: Point[]) => {
    h.onPointerDown!(ev(from))
    for (const p of to) h.onPointerMove!(ev(p))
    h.onPointerUp!(ev(to.at(-1) ?? from))
  }
  const click = (p: Point) => drag(p)
  return { store, history, state, h, drag, click }
}

describe('select tool', () => {
  it('is the single-instance default tool with shortcut V', () => {
    expect(selectTool.type).toBe('select')
    expect(selectTool.shortcut).toBe('V')
    expect(selectTool.allowMultipleInstances).toBe(false)
    expect(selectTool.Options).toBeNull()
    expect(selectTool.cursor!({})).toBe('default')
  })

  it('click selects the topmost annotation under the pointer', () => {
    const t = setup([box('under', [10, 10, 100, 50]), box('top', [50, 30, 150, 60])])
    t.click([60, 40])
    expect(t.state.selection).toEqual(['top'])
    t.click([20, 20])
    expect(t.state.selection).toEqual(['under'])
    expect(t.history.canUndo).toBe(false)
  })

  it('click on empty space deselects', () => {
    const t = setup([box('a', [10, 10, 100, 50])])
    t.click([20, 20])
    t.click([180, 90])
    expect(t.state.selection).toEqual([])
  })

  it('drag previews the move live and commits one update with translated geometry', () => {
    const t = setup([box('a', [10, 10, 100, 50])])
    t.state.selection = ['a'] // only the selected element moves
    t.h.onPointerDown!(ev([20, 20]))
    t.h.onPointerMove!(ev([25, 22]))
    expect(t.state.hidden).toEqual(['a'])
    expect((t.state.preview as FreeTextAnnotation).rect).toEqual([15, 12, 105, 52])
    expect(rectOf(t.store, 'a')).toEqual([10, 10, 100, 50])
    t.h.onPointerMove!(ev([30, 25]))
    t.h.onPointerUp!(ev([30, 25]))
    const moved = t.store.get('a') as FreeTextAnnotation
    expect(moved.rect).toEqual([20, 15, 110, 55])
    expect(moved.modifiedAt).not.toBe(base.modifiedAt)
    expect(t.state.preview).toBeNull()
    expect(t.state.hidden).toEqual([])
    expect(t.state.selection).toEqual(['a'])
    t.history.undo()
    expect(rectOf(t.store, 'a')).toEqual([10, 10, 100, 50])
    expect(t.history.canUndo).toBe(false)
  })

  it('a press without movement beyond the threshold commits nothing', () => {
    const t = setup([box('a', [10, 10, 100, 50])])
    t.drag([20, 20], [20.5, 20.5])
    expect(t.history.canUndo).toBe(false)
  })

  it('moves ink: kept on the page sideways, at most half out at the top of the first page', () => {
    const t = setup([ink('i', [[[20, 20], [40, 30]]])])
    t.state.selection = ['i']
    t.drag([30, 25], [-100, 500])
    const a = t.store.get('i') as InkAnnotation
    // Bounds [19, 19, 41, 31]: left edge on x 0, top 6pt (half its height) above the page.
    expect(a.strokes[0]).toEqual([[1, 95], [21, 105]])
  })

  it('drags an image over the bottom edge onto the next page as one undo step', () => {
    const im = { ...base, id: 'im', kind: 'image', rect: [20, 10, 40, 30], image: { width: 1, height: 1, png: '' } } as ImageAnnotation
    const t = setup([im], 2)
    t.state.selection = ['im']
    t.h.onPointerDown!(ev([30, 20]))
    t.h.onPointerMove!(ev([30, 15]))
    expect(t.state.crossDrag).toEqual({ page: 0 })
    // Screen 140..180; 10px down is cut off but stays.
    expect(t.state.preview!.page).toBe(0)
    // Pointer at client y 201 + 20: more than half (21px) out.
    t.h.onPointerMove!(ev([30, -0.5]))
    expect(t.state.preview!.page).toBe(1)
    expect(t.state.crossDrag).toEqual({ page: 0, at: 1 })
    expect((t.state.preview as ImageAnnotation).rect).toEqual([20, 80, 40, 100])
    t.h.onPointerUp!(ev([30, -0.5]))
    expect(t.state.crossDrag).toBeNull()
    const moved = t.store.get('im') as ImageAnnotation
    expect(moved.page).toBe(1)
    expect(t.store.byPage(1).map((a) => a.id)).toEqual(['im'])
    t.history.undo()
    expect(t.store.get('im')).toMatchObject({ page: 0, rect: [20, 10, 40, 30] })
    expect(t.history.canUndo).toBe(false)
  })

  it('a dropped element stays cut off by the page edge', () => {
    const im = { ...base, id: 'im', kind: 'image', rect: [20, 10, 40, 30], image: { width: 1, height: 1, png: '' } } as ImageAnnotation
    const t = setup([im], 2)
    t.state.selection = ['im']
    t.drag([30, 20], [30, 15], [30, 5])
    expect(t.store.get('im')).toMatchObject({ page: 0, rect: [20, -5, 40, 15] })
  })

  it('cancel after a snap restores the original page and position', () => {
    const im = { ...base, id: 'im', kind: 'image', rect: [20, 10, 40, 30], image: { width: 1, height: 1, png: '' } } as ImageAnnotation
    const t = setup([im], 2)
    t.state.selection = ['im']
    t.h.onPointerDown!(ev([30, 20]))
    t.h.onPointerMove!(ev([30, -5]))
    expect(t.state.preview!.page).toBe(1)
    t.h.onPointerCancel!(ev([30, -5]))
    expect(t.store.get('im')).toMatchObject({ page: 0, rect: [20, 10, 40, 30] })
    expect(t.state.preview).toBeNull()
    expect(t.state.crossDrag).toBeNull()
    expect(t.history.canUndo).toBe(false)
  })

  it('highlights stay fully on their page', () => {
    const hl = { ...base, id: 'h', kind: 'highlight', quads: [[20, 30, 60, 30, 20, 10, 60, 10]], color: [1, 1, 0], opacity: 0.4 } as Annotation
    const t = setup([hl], 2)
    t.state.selection = ['h']
    t.drag([30, 20], [30, 15], [30, -50])
    const a = t.store.get('h')!
    expect(a.page).toBe(0)
    expect((a as { quads: number[][] }).quads[0]).toEqual([20, 20, 60, 20, 20, 0, 60, 0])
    expect(t.state.crossDrag).toBeNull()
  })

  it('cancel restores the original', () => {
    const t = setup([box('a', [10, 10, 100, 50])])
    t.state.selection = ['a'] // only the selected element moves
    t.h.onPointerDown!(ev([20, 20]))
    t.h.onPointerMove!(ev([60, 60]))
    t.h.onPointerCancel!(ev([60, 60]))
    expect(rectOf(t.store, 'a')).toEqual([10, 10, 100, 50])
    expect(t.state.preview).toBeNull()
    expect(t.state.hidden).toEqual([])
    expect(t.history.canUndo).toBe(false)
  })

  it('dragging a text box e handle changes its width, re-wraps lines and fits the height', () => {
    const text = 'the quick brown fox jumps'
    const t = setup([box('a', [10, 70, 210, 90], text)])
    t.click([50, 80]) // select
    // e handle in the middle of the right edge; drag it 120pt left.
    t.drag([210, 80], [90, 80])
    const a = t.store.get('a') as FreeTextAnnotation
    const lines = layoutLines(text, 10, 80)
    expect(lines.length).toBeGreaterThan(1)
    expect(a.lines).toEqual(lines)
    // The top-left corner stays; the height fits the lines.
    expect(a.rect).toEqual([10, 90 - boxHeight(lines.length, 10), 90, 90])
    expect(t.history.canUndo).toBe(true)
  })

  it('text box w handle keeps the right edge and stops at the minimum width (one letter)', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    t.click([50, 80])
    t.drag([10, 80], [180, 80])
    const a = t.store.get('a') as FreeTextAnnotation
    expect(a.rect[2]).toBeCloseTo(110)
    expect(a.rect[0]).toBeCloseTo(110 - minBoxWidth(10))
  })

  it('resizes text boxes on rotated pages along their on-screen width', () => {
    currentVp = vp90
    try {
      const text = 'the quick brown fox jumps'
      const rect = pageBoxRect([50, 10], 100, 20, 90) // [50, 10, 70, 110]
      const t = setup([box('a', rect, text)])
      t.click([60, 50])
      // w handle: screen left edge = pdf y 10; drag it 20pt to screen-right (+y).
      t.drag([60, 10], [60, 30])
      const lines = layoutLines(text, 10, 80)
      const a = t.store.get('a') as FreeTextAnnotation
      expect(a.lines).toEqual(lines)
      expect(a.rect).toEqual(pageBoxRect([50, 30], 80, boxHeight(lines.length, 10), 90))
    } finally {
      currentVp = vp
    }
  })

  it('text boxes have no vertical handles: a press on the top edge middle moves', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    t.click([50, 80])
    t.drag([60, 90], [60, 80])
    expect(rectOf(t.store, 'a')).toEqual([10, 60, 110, 80])
  })

  it('ink se handle scales the strokes proportionally to the new box', () => {
    const t = setup([ink('i', [[[20, 20], [40, 40]]], 2)])
    t.click([30, 30])
    // Bounds [19, 19, 41, 41]; the se corner (screen bottom-right) is pdf (41, 19).
    // Dragging it 20pt right doubles the stroke extent in x.
    t.drag([41, 19], [61, 19])
    const a = t.store.get('i') as InkAnnotation
    expect(a.strokes[0][0][0]).toBeCloseTo(20)
    expect(a.strokes[0][0][1]).toBeCloseTo(20)
    expect(a.strokes[0][1][0]).toBeCloseTo(60)
    expect(a.strokes[0][1][1]).toBeCloseTo(40)
    expect(t.history.canUndo).toBe(true)
  })

  it('shapes have all 8 handles; the nw handle resizes the geometric rect', () => {
    const s: ShapeAnnotation = {
      ...base, id: 's', kind: 'shape', shape: 'circle', rect: [20, 20, 40, 40],
      border: { color: [1, 0, 0], width: 4, opacity: 1 }, fill: null,
    }
    expect(handlesFor(s)).toEqual(ALL_HANDLES)
    const t = setup([s])
    t.click([40, 30]) // on the outline
    expect(t.state.selection).toEqual(['s'])
    // Bounds [18, 18, 42, 42]; the nw corner (screen top-left) is pdf (18, 42).
    t.drag([18, 42], [8, 52])
    expect((t.store.get('s') as ShapeAnnotation).rect).toEqual([10, 20, 40, 50])
    expect(t.history.canUndo).toBe(true)
  })

  it('images have all 8 handles; a corner keeps the aspect ratio', () => {
    const im: ImageAnnotation = {
      ...base, id: 'im', kind: 'image', rect: [20, 20, 60, 40], image: { width: 4, height: 2, png: 'AA==' },
    }
    expect(handlesFor(im)).toEqual(ALL_HANDLES)
    const t = setup([im])
    t.click([40, 30])
    expect(t.state.selection).toEqual(['im'])
    // se corner = pdf (60, 20). Free: 60 x 25; the larger factor (1.5) wins,
    // anchored at the nw corner (20, 40).
    t.drag([60, 20], [80, 15])
    expect((t.store.get('im') as ImageAnnotation).rect).toEqual([20, 10, 80, 40])
  })

  it('an image corner stops where the scaled image would leave the page', () => {
    const t = setup([{ ...base, id: 'im', kind: 'image', rect: [20, 20, 60, 40], image: { width: 4, height: 2, png: 'AA==' } } as ImageAnnotation])
    t.click([40, 30])
    // Wide drag: 4.5x would need 90pt of height below y = 40; only 40 are left (2x).
    t.drag([60, 20], [300, 20])
    expect((t.store.get('im') as ImageAnnotation).rect).toEqual([20, 0, 100, 40])
  })

  it('an image sticking out of the page is not shrunk or mirrored by a corner drag', () => {
    // Page is 200 pt wide; the image reaches 20 pt past the right edge.
    const t = setup([{ ...base, id: 'im', kind: 'image', rect: [180, 20, 220, 40], image: { width: 4, height: 2, png: 'AA==' } } as ImageAnnotation])
    t.click([190, 30])
    // ne corner (220, 40) dragged up: the pointer is clamped to the page edge.
    t.drag([220, 40], [230, 50])
    const r = (t.store.get('im') as ImageAnnotation).rect
    expect(r[0]).toBe(180)
    expect(r[1]).toBe(20)
    expect(r[2] - r[0]).toBeGreaterThanOrEqual(40)
    expect((r[2] - r[0]) / (r[3] - r[1])).toBeCloseTo(2)
  })

  it('an image edge handle stretches it freely', () => {
    const t = setup([{ ...base, id: 'im', kind: 'image', rect: [20, 20, 60, 40], image: { width: 4, height: 2, png: 'AA==' } } as ImageAnnotation])
    t.click([40, 30])
    t.drag([60, 30], [70, 30])
    expect((t.store.get('im') as ImageAnnotation).rect).toEqual([20, 20, 70, 40])
  })

  it('double-click on a text box opens its editor', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    clock = 1000
    t.click([50, 80])
    expect(t.state.edit).toBeNull()
    clock = 1200
    t.click([50, 80])
    expect(t.state.edit?.draft.id).toBe('a')
    expect(t.state.hidden).toEqual(['a'])
    // The next press commits the edit.
    t.state.edit!.setText('changed')
    clock = 5000
    t.click([180, 10])
    expect(t.state.edit).toBeNull()
    expect((t.store.get('a') as FreeTextAnnotation).text).toBe('changed')
  })

  it('two slow clicks do not open the editor', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    clock = 1000
    t.click([50, 80])
    clock = 2000
    t.click([50, 80])
    expect(t.state.edit).toBeNull()
  })

  it('passes through to the text layer only where nothing is under the pointer', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    expect(t.h.passThroughAt!(ev([50, 80]))).toBe(false)
    expect(t.h.passThroughAt!(ev([150, 20]))).toBe(true)
    t.h.onPassThroughDown!(ev([50, 80]))
    expect(t.state.selection).toEqual(['a'])
    // A selected box's handle (just outside the box) also takes the press.
    expect(t.h.passThroughAt!(ev([112, 80]))).toBe(false)
    t.h.onPassThroughDown!(ev([150, 20]))
    expect(t.state.selection).toEqual([])
  })

  it('deactivation clears the selection', () => {
    const t = setup([box('a', [10, 70, 110, 90])])
    t.click([50, 80])
    t.h.onDeactivate!()
    expect(t.state.selection).toEqual([])
  })
})

describe('select tool rotation', () => {
  const close = (p: readonly number[], q: readonly number[]) => p.forEach((v, i) => expect(v).toBeCloseTo(q[i], 6))
  /** The PDF point at screen (x, y) on `vp`. */
  const at = (x: number, y: number): Point => [x / 2, 100 - y / 2]
  const shifted = (e: PagePointerEvent): PagePointerEvent => ({ ...e, native: { ...e.native, shiftKey: true } as PointerEvent })
  const filled = (over: Partial<ShapeAnnotation> = {}): ShapeAnnotation => ({
    ...base, id: 's', kind: 'shape', shape: 'rect', rect: [50, 40, 90, 60], border: null,
    fill: { color: [0, 0, 1], opacity: 1 }, ...over,
  })

  it('turns a selected shape with the rotate handle below its box, as one undo step', () => {
    currentVp = vp
    const t = setup([filled()])
    t.state.selection = ['s']
    // Box on screen [100, 80, 180, 120]: the bar goes above, the rotate handle below at (140, 142); the centre is (140, 100).
    expect(t.h.rotatingFrame!()).toBeNull()
    t.h.onHover!(ev(at(140, 142)))
    expect(t.state.cursor).toContain('crosshair')
    t.h.onPointerDown!(ev(at(140, 142)))
    t.h.onPointerMove!(ev(at(80, 100)))
    // From straight below the centre to straight left of it: a quarter turn clockwise.
    expect((t.state.preview as ShapeAnnotation).rotation).toBeCloseTo(-90)
    expect(t.h.rotatingFrame!()).toEqual({ page: 0, rect: [50, 40, 90, 60], angle: expect.closeTo(-90) })
    t.h.onPointerUp!(ev(at(80, 100)))
    const turned = t.store.get('s') as ShapeAnnotation
    expect(turned.rotation).toBeCloseTo(-90)
    expect(turned.rect).toEqual([50, 40, 90, 60])
    expect(t.h.rotatingFrame!()).toBeNull()
    t.history.undo()
    expect('rotation' in t.store.get('s')!).toBe(false)
  })

  it('snaps the angle to 15 degree steps while Shift is held', () => {
    currentVp = vp
    const t = setup([filled({ rotation: 10 })])
    t.state.selection = ['s']
    // The handle of a box turned 10 degrees: below the centre in the box's own frame.
    const t10 = (10 * Math.PI) / 180
    const handle = at(140 + 42 * Math.sin(t10), 100 + 42 * Math.cos(t10))
    t.h.onPointerDown!(ev(handle))
    // 37 degrees further counter-clockwise: 47 in all, snapped to 45.
    const a = ((-90 + 10 + 37) * Math.PI) / 180
    const to = at(140 + 50 * Math.cos(a), 100 - 50 * Math.sin(a))
    t.h.onPointerMove!(ev(to))
    expect((t.state.preview as ShapeAnnotation).rotation).toBeCloseTo(47)
    t.h.onPointerMove!(shifted(ev(to)))
    expect((t.state.preview as ShapeAnnotation).rotation).toBeCloseTo(45)
  })

  it('turns ink points around the centre of its box, the box turning with them meanwhile', () => {
    currentVp = vp
    const t = setup([ink('i', [[[40, 50], [60, 50]]])])
    t.state.selection = ['i']
    // Bounds [39, 49, 61, 51] → screen [78, 98, 122, 102]: handle at (100, 124), centre (100, 100).
    t.h.onPointerDown!(ev(at(100, 124)))
    t.h.onPointerMove!(ev(at(78, 100)))
    expect(t.h.rotatingFrame!()).toEqual({ page: 0, rect: [39, 49, 61, 51], angle: expect.closeTo(-90) })
    t.h.onPointerUp!(ev(at(78, 100)))
    const turned = t.store.get('i') as InkAnnotation
    close(turned.strokes.flat(2), [50, 60, 50, 40])
    expect('rotation' in turned).toBe(false)
    expect(t.history.canUndo).toBe(true)
  })

  it('offers no rotate handle on highlights', () => {
    currentVp = vp
    const hl: Annotation = { ...base, id: 'h', kind: 'highlight', quads: [[50, 60, 90, 60, 50, 40, 90, 40]], color: [1, 1, 0], opacity: 0.4 }
    const t = setup([hl])
    t.state.selection = ['h']
    // Below the box is blank space: the hand, not the rotate cursor.
    t.h.onHover!(ev(at(140, 142)))
    expect(t.state.cursor).toBe('grab')
  })

  it('resizes a turned shape along its own sides, the opposite side staying put', () => {
    currentVp = vp
    const t = setup([filled({ rotation: 90 })])
    t.state.selection = ['s']
    // Turned a quarter counter-clockwise, its east handle sits at the top on screen (140, 60).
    t.h.onHover!(ev(at(140, 60)))
    expect(t.state.cursor).toBe('ns-resize')
    t.drag(at(140, 60), at(140, 50), at(140, 40))
    const s = t.store.get('s') as ShapeAnnotation
    close(s.rect, [45, 45, 95, 65])
    expect(s.rotation).toBe(90)
    // Turned bounds: the bottom stays at y 30, the top moves up 10 pt.
    close(annotationKinds.get('shape').bounds(s), [60, 30, 80, 80])
  })

  it('moves a turned text box from inside its turned box', () => {
    currentVp = vp
    const t = setup([box('a', [50, 40, 90, 60], 'hi')])
    t.store.update('a', { ...(t.store.get('a') as FreeTextAnnotation), rotation: 90 })
    t.state.selection = ['a']
    // (65, 64) lies in the turned box only.
    t.drag([65, 64], [67, 64])
    close((t.store.get('a') as FreeTextAnnotation).rect, [52, 40, 92, 60])
  })
})
