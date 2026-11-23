import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNMARK_COLOR, listenForUnmark, unmarkCommand, type TextMarkupKind } from '../../../src/tools/shared/unmark'
import { createMarkerHandler } from '../../../src/tools/marker'
import type { ToolContext } from '../../../src/core/registry/tools'
import type { Annotation, Point, Quad, TextLineAnnotation } from '../../../src/core/session/model'
import type { Command } from '../../../src/core/session/history.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { registerTextLayer } from '../../../src/core/viewer/textLayers'

/**
 * Text layers without layout: each span carries its client rect, its
 * characters are equally wide. caretRangeFromPoint and Range.getClientRects
 * are stubbed from those rects. Page box: client y maps to PDF y = 1000 - y.
 */
function layer(page: number, spans: { text: string; rect: [number, number, number, number] }[]) {
  const el = document.createElement('div')
  for (const s of spans) {
    const span = document.createElement('span')
    span.textContent = s.text
    span.dataset.rect = s.rect.join(',')
    el.append(span)
  }
  document.body.append(el)
  cleanup.push(registerTextLayer(el, { page, toPdf: (x: number, y: number): Point => [x, 1000 - y] }))
  return el
}

const rectOf = (span: Element) => (span as HTMLElement).dataset.rect!.split(',').map(Number)

/** Upright quad in PDF space from client x1..x2, y top..bottom. */
const quad = (x1: number, x2: number, top: number, bottom: number): Quad => [
  x1, 1000 - top, x2, 1000 - top, x1, 1000 - bottom, x2, 1000 - bottom,
]

let cleanup: (() => void)[] = []
let frames: FrameRequestCallback[] = []
const runFrames = () => {
  const pending = frames
  frames = []
  pending.forEach((f) => f(0))
}
const originalGetClientRects = Range.prototype.getClientRects

beforeEach(() => {
  // The context-menu guard after a drag expires on a timer: run it out between tests.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  frames = []
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {}
  })
  ;(document as unknown as { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint = (
    x,
    y,
  ) => {
    for (const span of document.querySelectorAll<HTMLElement>('span[data-rect]')) {
      const [l, t, r, b] = rectOf(span)
      if (x < l || x > r || y < t || y > b) continue
      const text = span.firstChild!
      const n = text.textContent!.length
      const range = document.createRange()
      range.setStart(text, Math.round(((x - l) / (r - l)) * n))
      return range
    }
    return null
  }
  Range.prototype.getClientRects = function (this: Range) {
    const span = this.startContainer.parentElement
    if (!span?.dataset.rect || this.collapsed || this.startContainer !== this.endContainer) return [] as unknown as DOMRectList
    const [l, t, r, b] = rectOf(span)
    const w = (r - l) / this.startContainer.textContent!.length
    const left = l + this.startOffset * w
    const right = l + this.endOffset * w
    return [{ left, top: t, right, bottom: b, width: right - left, height: b - t }] as unknown as DOMRectList
  }
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  Range.prototype.getClientRects = originalGetClientRects
  delete (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint
  cleanup.forEach((f) => f())
  cleanup = []
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function setup(kind: () => TextMarkupKind | null, existing: Annotation[]) {
  const store = new AnnotationStore()
  existing.forEach((a) => store.add(a))
  const executed: Command[] = []
  const previews: Annotation[][] = []
  const ctx = {
    execute: (c: Command) => {
      executed.push(c)
      c.do(store)
    },
    pagePreviews: { set: (list: readonly Annotation[]) => previews.push([...list]) },
    session: { store },
  } as unknown as ToolContext
  cleanup.push(listenForUnmark(ctx, kind))
  return { store, executed, previews }
}

const base = { page: 0, sourceRef: null, modifiedAt: 'old', author: 'A' }
const underline = (id: string, quads: Quad[]): TextLineAnnotation => ({ ...base, id, kind: 'underline', quads, color: [1, 0, 0] })

const ev = (type: string, target: EventTarget, x: number, y: number, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }))
const down = (target: Element, x: number, y: number) => ev('pointerdown', target, x, y, { button: 2, buttons: 2 })
const move = (x: number, y: number, buttons = 2) => ev('pointermove', window, x, y, { buttons })
const up = (x: number, y: number) => ev('pointerup', window, x, y, { button: 2 })
/** The context menu that follows a right release; true when nothing cancelled it. */
const contextMenu = (target: Element) => ev('contextmenu', target, 0, 0, { button: 2 })

describe('right-button unmark drag', () => {
  // "Hello world": 11 characters, 10px each, from x=0.
  const spans = [{ text: 'Hello world', rect: [0, 100, 110, 110] as [number, number, number, number] }]

  it('tints the dragged-over text blue, then cuts it out of the marked text on release', () => {
    const el = layer(0, spans)
    const span = el.firstElementChild!
    const { store, executed, previews } = setup(() => 'underline', [underline('u', [quad(0, 110, 100, 110)])])
    const pageListener = vi.fn()
    span.addEventListener('contextmenu', pageListener)

    down(span, 20, 105)
    move(50, 105)
    expect(previews).toHaveLength(0)
    runFrames()
    expect(previews).toEqual([
      [expect.objectContaining({ kind: 'highlight', page: 0, color: UNMARK_COLOR, quads: [quad(20, 50, 100, 110)] })],
    ])
    up(50, 105)

    expect(previews.at(-1)).toEqual([])
    expect(executed).toHaveLength(1)
    expect((store.get('u') as TextLineAnnotation).quads).toEqual([quad(0, 20, 100, 110), quad(50, 110, 100, 110)])
    expect(store.get('u')!.modifiedAt).not.toBe('old')
    // The release's context menu neither shows nor opens the page menu.
    expect(contextMenu(span)).toBe(false)
    expect(pageListener).not.toHaveBeenCalled()
    // Only that one: the next right click opens the page menu again.
    expect(contextMenu(span)).toBe(true)

    executed[0].undo(store)
    expect((store.get('u') as TextLineAnnotation).quads).toEqual([quad(0, 110, 100, 110)])
  })

  it('a drag from right to left works the same, and removes fully covered markup', () => {
    const el = layer(0, spans)
    const span = el.firstElementChild!
    const { store } = setup(() => 'underline', [underline('u', [quad(20, 50, 100, 110)])])
    down(span, 60, 105)
    move(10, 105)
    up(10, 105)
    expect(store.get('u')).toBeUndefined()
  })

  it('a right click without a drag changes nothing and leaves the page menu alone', () => {
    const el = layer(0, spans)
    const span = el.firstElementChild!
    const { executed, previews } = setup(() => 'underline', [underline('u', [quad(0, 110, 100, 110)])])
    down(span, 20, 105)
    move(22, 105)
    up(22, 105)
    runFrames()
    expect(executed).toHaveLength(0)
    expect(previews).toHaveLength(0)
    expect(contextMenu(span)).toBe(true)
  })

  it("unmarks only the active tool's kind", () => {
    const el = layer(0, spans)
    const strike: TextLineAnnotation = { ...underline('s', [quad(0, 110, 100, 110)]), kind: 'strikeout' }
    const { store, executed } = setup(() => 'underline', [strike])
    down(el.firstElementChild!, 20, 105)
    move(80, 105)
    up(80, 105)
    expect(executed).toHaveLength(0)
    expect(store.get('s')).toEqual(strike)
  })

  it('ignores presses outside text layers and tools that do not unmark', () => {
    const el = layer(0, spans)
    const outside = document.createElement('div')
    document.body.append(outside)
    const off = setup(() => null, [underline('u', [quad(0, 110, 100, 110)])])
    down(el.firstElementChild!, 20, 105)
    move(80, 105)
    up(80, 105)
    expect(off.executed).toHaveLength(0)
    cleanup.pop()!()

    const on = setup(() => 'underline', [underline('u', [quad(0, 110, 100, 110)])])
    down(outside, 20, 105)
    move(80, 105)
    up(80, 105)
    expect(on.executed).toHaveLength(0)
  })

  it('the marker unmarks highlights in text mode only (freehand mode erases instead)', () => {
    const el = layer(0, spans)
    const span = el.firstElementChild!
    const store = new AnnotationStore()
    const hl = { ...base, id: 'h', kind: 'highlight' as const, quads: [quad(0, 110, 100, 110)], color: [1, 1, 0] as [number, number, number], opacity: 0.4 }
    store.add(hl)
    const executed: Command[] = []
    const ctx = {
      execute: (c: Command) => executed.push(c),
      preview: { set: () => {} },
      pagePreviews: { set: () => {} },
      session: { store },
    } as unknown as ToolContext
    let mode: 'text' | 'freehand' = 'freehand'
    const handler = createMarkerHandler(ctx, () => ({ mode, color: [1, 1, 0], opacity: 0.4, width: 14 }))
    cleanup.push(() => handler.onDeactivate!())

    down(span, 20, 105)
    move(80, 105)
    up(80, 105)
    expect(executed).toHaveLength(0)

    mode = 'text'
    down(span, 20, 105)
    move(80, 105)
    up(80, 105)
    expect(executed).toHaveLength(1)
  })
})

describe('unmarkCommand', () => {
  it('is null when the cut touches no markup of that kind', () => {
    const store = new AnnotationStore()
    store.add(underline('u', [quad(0, 110, 100, 110)]))
    expect(unmarkCommand(store, 'underline', [{ page: 0, quads: [quad(0, 50, 300, 310)] }])).toBeNull()
    expect(unmarkCommand(store, 'highlight', [{ page: 0, quads: [quad(0, 50, 100, 110)] }])).toBeNull()
  })

  it('updates trimmed and deletes emptied annotations in one undo step', () => {
    const store = new AnnotationStore()
    store.add(underline('a', [quad(0, 110, 100, 110)]))
    store.add(underline('b', [quad(0, 40, 120, 130)]))
    const cmd = unmarkCommand(store, 'underline', [{ page: 0, quads: [quad(60, 110, 100, 110), quad(0, 40, 120, 130)] }], 'now')!
    cmd.do(store)
    expect(store.get('a')).toMatchObject({ quads: [quad(0, 60, 100, 110)], modifiedAt: 'now' })
    expect(store.get('b')).toBeUndefined()
    cmd.undo(store)
    expect(store.byPage(0).map((x) => x.id)).toEqual(['a', 'b'])
    expect((store.get('a') as TextLineAnnotation).quads).toEqual([quad(0, 110, 100, 110)])
  })
})
