import { describe, expect, it, vi } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../../src/annotations'
import { createSelectHandler, type SelectLinks } from '../../../src/tools/select'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation, Point, ShapeAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { linkAt, type PageLink } from '../../../src/core/viewer/links'

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), message: vi.fn() }))

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

/** A web link over the text line (y 50..60, x 100..150) and an internal link on blank space. */
const web: PageLink = { rect: [100, 50, 150, 60], target: { kind: 'url', url: 'https://example.com/' } }
const internal: PageLink = { rect: [10, 80, 40, 90], target: { kind: 'dest', dest: 'ch1' } }

function setup(loaded: Annotation[] = [], known = true) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const scrollBy = vi.fn()
  const state = {
    selection: [] as string[],
    cursor: null as string | null,
    hint: null as { page: number; text: string } | null,
  }
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
    hint: { set: (h: { page: number; text: string } | null) => void (state.hint = h) },
  } as unknown as ToolContext
  const follow = vi.fn()
  const links: SelectLinks = { at: (_page, p, tol) => (known ? linkAt([web, internal], p, tol) : undefined), follow }
  // Text only in the band 50 ≤ y ≤ 60.
  const textAt = (_page: number, p: Point) => p[1] >= 50 && p[1] <= 60
  return { state, follow, scrollBy, h: createSelectHandler(ctx, textAt, links) }
}

describe('select tool: links', () => {
  it('takes presses on a link over text instead of passing them to the text layer', () => {
    const t = setup()
    expect(t.h.passThroughAt!(ev([120, 55]))).toBe(false)
    expect(t.h.passThroughAt!(ev([80, 55]))).toBe(true)
    // Links not loaded yet: text selection as before.
    expect(setup([], false).h.passThroughAt!(ev([120, 55]))).toBe(true)
  })

  it('shows the pointer, and a web link its address, on hover', () => {
    const t = setup()
    t.h.onHover!(ev([120, 55]))
    expect(t.state.cursor).toBe('pointer')
    expect(t.state.hint).toEqual({ page: 0, text: 'https://example.com/' })
    t.h.onHover!(ev([20, 85]))
    expect(t.state.cursor).toBe('pointer')
    expect(t.state.hint).toBeNull()
    t.h.onHover!(ev([180, 20]))
    expect(t.state.cursor).toBe('grab')
  })

  it('follows a link on a stationary click, deselecting', () => {
    const t = setup([sq('a', 170, 10)])
    t.state.selection = ['a']
    t.h.onPointerDown!(ev([20, 85]))
    expect(t.state.selection).toEqual([])
    t.h.onPointerMove!(ev([20.5, 85]))
    t.h.onPointerUp!(ev([20.5, 85]))
    expect(t.follow).toHaveBeenCalledWith(internal, 0)
    expect(t.scrollBy).not.toHaveBeenCalled()
  })

  it('pans instead when the press on a link is dragged', () => {
    const t = setup()
    t.h.onPointerDown!(ev([20, 85]))
    t.h.onPointerMove!(ev([30, 80]))
    expect(t.state.cursor).toBe('grabbing')
    expect(t.scrollBy).toHaveBeenCalled()
    t.h.onPointerUp!(ev([30, 80]))
    expect(t.follow).not.toHaveBeenCalled()
  })

  it('lets an annotation on a link win: the click selects it', () => {
    const t = setup([sq('a', 15, 80)])
    t.h.onHover!(ev([20, 85]))
    expect(t.state.cursor).not.toBe('pointer')
    t.h.onPointerDown!(ev([20, 85]))
    t.h.onPointerUp!(ev([20, 85]))
    expect(t.state.selection).toEqual(['a'])
    expect(t.follow).not.toHaveBeenCalled()
  })

  it('follows nothing after a cancelled press', () => {
    const t = setup()
    t.h.onPointerDown!(ev([20, 85]))
    t.h.onPointerCancel!(ev([20, 85]))
    t.h.onPointerUp!(ev([20, 85]))
    expect(t.follow).not.toHaveBeenCalled()
  })
})
