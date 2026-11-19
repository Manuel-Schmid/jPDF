import { describe, expect, it, vi } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../../src/annotations'
import { createSelectHandler } from '../../../src/tools/select'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, Point, ShapeAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import type { TextLookup } from '../../../src/core/viewer/textBoxes'

// Page 200 x 100 pt at scale 2: screen = (2x, 2(100 - y)), client = screen.
const vp = {
  scale: 2,
  rotation: 0,
  width: 400,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

function ev(pdf: Point): PagePointerEvent {
  const [x, y] = vp.convertToViewportPoint(pdf[0], pdf[1])
  const native = { clientX: x, clientY: y, timeStamp: 0 } as PointerEvent
  return { page: 0, pdf, screen: [x, y], vp, native, toPdf: () => pdf }
}

function sq(id: string, x: number, y: number): ShapeAnnotation {
  return {
    id, page: 0, sourceRef: null, modifiedAt: 't', author: 'A', kind: 'shape', shape: 'rect',
    rect: [x, y, x + 10, y + 10], border: null, fill: { color: [0, 1, 0], opacity: 1 },
  }
}

/** Text only in the band 50 ≤ y ≤ 60 (a line of text); `known` false: text not loaded yet. */
const textBand = (known = true): TextLookup => (_page, p) => (known ? p[1] >= 50 && p[1] <= 60 : null)

function setup(loaded: Annotation[], textAt: TextLookup = textBand()) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const scrollBy = vi.fn()
  const state = { selection: [] as string[], cursor: null as string | null }
  const ctx = {
    session: { store, history, scrollBy, pendingEdit: null },
    execute: (c: Parameters<History['execute']>[0]) => history.execute(c),
    selection: {
      get ids() {
        return state.selection
      },
      set: (ids: string[]) => void (state.selection = ids),
    },
    preview: { set: () => {} },
    hidden: { ids: new Set(), set: () => {} },
    cursor: { set: (c: string | null) => void (state.cursor = c) },
    textEdit: { set: () => {} },
  } as unknown as ToolContext
  return { store, state, scrollBy, h: createSelectHandler(ctx, textAt) }
}

describe('select tool: the hand on blank space', () => {
  it('lets presses over text through to the text layer, and keeps blank space for itself', () => {
    const t = setup([sq('a', 20, 20)])
    expect(t.h.passThroughAt!(ev([100, 55]))).toBe(true)
    expect(t.h.passThroughAt!(ev([100, 80]))).toBe(false)
    // An annotation is never passed through, text or not.
    expect(t.h.passThroughAt!(ev([25, 25]))).toBe(false)
  })

  it('passes through as before while the page text is not known yet', () => {
    const t = setup([], textBand(false))
    expect(t.h.passThroughAt!(ev([100, 80]))).toBe(true)
  })

  it('a drag on blank space pans the view, deselecting, with the grabbing hand', () => {
    const t = setup([sq('a', 20, 20)])
    t.state.selection = ['a']
    t.h.onPointerDown!(ev([100, 80]))
    expect(t.state.selection).toEqual([])
    expect(t.state.cursor).toBe('grabbing')
    t.h.onPointerMove!(ev([110, 75]))
    t.h.onPointerMove!(ev([120, 75]))
    // Pointer moved right 20px and down 10px, then right 20px: the view scrolls the other way.
    expect(t.scrollBy.mock.calls).toEqual([[-20, -10], [-20, -0]])
    t.h.onPointerUp!(ev([120, 75]))
    expect(t.state.cursor).toBe('grab')
    t.h.onPointerMove!(ev([150, 75]))
    expect(t.scrollBy).toHaveBeenCalledTimes(2)
    expect(t.store.get('a')!).toEqual(sq('a', 20, 20))
  })

  it('shows the open hand over blank space only', () => {
    const t = setup([sq('a', 20, 20)])
    t.h.onHover!(ev([100, 80]))
    expect(t.state.cursor).toBe('grab')
    t.h.onHover!(ev([25, 25]))
    expect(t.state.cursor).toBeNull()
  })

  it('a pan cancelled or the tool switched away stops scrolling', () => {
    const t = setup([])
    t.h.onPointerDown!(ev([100, 80]))
    t.h.onPointerCancel!(ev([100, 80]))
    t.h.onPointerMove!(ev([150, 80]))
    t.h.onPointerDown!(ev([100, 80]))
    t.h.onDeactivate!()
    t.h.onPointerMove!(ev([150, 80]))
    expect(t.scrollBy).not.toHaveBeenCalled()
  })
})

describe('select tool: right-click', () => {
  it('selects the annotation under the pointer for the menu', () => {
    const t = setup([sq('a', 20, 20), sq('b', 50, 20)])
    t.state.selection = ['a']
    expect(t.h.onContextMenu!(ev([55, 25]))).toBe(true)
    expect(t.state.selection).toEqual(['b'])
  })

  it('on blank space keeps the selection and opens the plain page menu', () => {
    const t = setup([sq('a', 20, 20)])
    t.state.selection = ['a']
    expect(t.h.onContextMenu!(ev([150, 80]))).toBe(false)
    expect(t.state.selection).toEqual(['a'])
  })

  it('never selects flattened annotations', () => {
    const t = setup([{ ...sq('a', 20, 20), flattened: true }])
    expect(t.h.onContextMenu!(ev([25, 25]))).toBe(false)
    expect(t.state.selection).toEqual([])
  })
})
