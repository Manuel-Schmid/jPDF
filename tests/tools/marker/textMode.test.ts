import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkerHandler } from '../../../src/tools/marker'
import { FALLBACK_MESSAGE } from '../../../src/tools/marker/textMode'
import type { MarkerSettings } from '../../../src/tools/marker/settings'
import type { PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Annotation, HighlightAnnotation, Point } from '../../../src/core/session/model'
import type { Command } from '../../../src/core/session/history.svelte'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { registerTextLayer } from '../../../src/core/viewer/textLayers'
import { settings as appSettings } from '../../../src/core/settings/settings.svelte'
import { toasts } from '../../../src/ui/toasts.svelte'

const textSettings: MarkerSettings = { mode: 'text', color: [0.094, 1, 1], opacity: 0.4, width: 14 }

/**
 * A text layer whose spans carry their client rect in data attributes; the
 * Range.getClientRects stub returns the rect of the text node's span.
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
  // Page box: client y=top maps to PDF y = 1000 - y; x unchanged.
  const toPdf = (x: number, y: number): Point => [x, 1000 - y]
  const unregister = registerTextLayer(el, { page, toPdf })
  return { el, unregister }
}

function setup(s: MarkerSettings = textSettings) {
  const executed: Command[] = []
  const ctx = {
    execute: (c: Command) => executed.push(c),
    preview: { set: () => {} },
    session: { store: new AnnotationStore() },
  } as unknown as ToolContext
  const handler = createMarkerHandler(ctx, () => s)
  const committed = () => {
    const added: Annotation[] = []
    executed[0].do({ add: (a: Annotation) => added.push(a) } as never)
    return added
  }
  return { executed, handler, committed }
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  return sel
}

/** The pointerdown that starts a gesture, on `target`. */
const pointerDown = (target: Element) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
const pointerUp = () => window.dispatchEvent(new MouseEvent('pointerup', { button: 0 }))

let cleanup: (() => void)[] = []
const originalGetClientRects = Range.prototype.getClientRects

beforeEach(() => {
  Range.prototype.getClientRects = function (this: Range) {
    const span = this.startContainer.parentElement
    if (!span?.dataset.rect || this.collapsed) return [] as unknown as DOMRectList
    const [left, top, right, bottom] = span.dataset.rect.split(',').map(Number)
    return [{ left, top, right, bottom, width: right - left, height: bottom - top }] as unknown as DOMRectList
  }
})

afterEach(() => {
  Range.prototype.getClientRects = originalGetClientRects
  cleanup.forEach((f) => f())
  cleanup = []
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('marker text mode', () => {
  it('a selection across two pages commits one command with one highlight per page', () => {
    const a = layer(0, [
      { text: 'Hello ', rect: [10, 100, 50, 110] },
      { text: 'world', rect: [52, 100, 90, 110] },
      { text: 'second line', rect: [10, 120, 80, 130] },
    ])
    const b = layer(1, [{ text: 'next page', rect: [20, 400, 70, 412] }])
    cleanup.push(a.unregister, b.unregister)
    const { executed, handler, committed } = setup()
    cleanup.push(() => handler.onDeactivate!())

    pointerDown(a.el.firstChild as Element)
    const sel = select(a.el.firstChild!.firstChild!, 0, b.el.firstChild!.firstChild!, 4)
    pointerUp()

    expect(executed).toHaveLength(1)
    const added = committed() as HighlightAnnotation[]
    expect(added).toHaveLength(2)
    expect(added[0]).toMatchObject({
      kind: 'highlight',
      page: 0,
      sourceRef: null,
      color: [0.094, 1, 1],
      opacity: 0.4,
      author: appSettings.data.author,
      quads: [
        [10, 900, 90, 900, 10, 890, 90, 890], // "Hello " + "world" merged
        [10, 880, 80, 880, 10, 870, 80, 870],
      ],
    })
    expect(added[1]).toMatchObject({ page: 1, quads: [[20, 600, 70, 600, 20, 588, 70, 588]] })
    expect(added[0].id).not.toBe(added[1].id)
    expect(sel.rangeCount).toBe(0)
  })

  it('ignores collapsed selections and selections outside text layers', () => {
    const a = layer(0, [{ text: 'Hello', rect: [10, 100, 50, 110] }])
    cleanup.push(a.unregister)
    const outside = document.createElement('p')
    outside.textContent = 'toolbar label'
    document.body.append(outside)
    const { executed, handler } = setup()
    cleanup.push(() => handler.onDeactivate!())

    select(a.el.firstChild!.firstChild!, 2, a.el.firstChild!.firstChild!, 2)
    pointerUp()
    select(outside.firstChild!, 0, outside.firstChild!, 5)
    pointerUp()
    expect(executed).toHaveLength(0)
  })

  it('ignores a selection whose gesture did not start in a text layer (Ctrl+A, then a toolbar click)', () => {
    const a = layer(0, [{ text: 'Hello', rect: [10, 100, 50, 110] }])
    cleanup.push(a.unregister)
    const toolbar = document.createElement('button')
    document.body.append(toolbar)
    const { executed, handler } = setup()
    cleanup.push(() => handler.onDeactivate!())

    select(a.el.firstChild!.firstChild!, 0, a.el.firstChild!.firstChild!, 5)
    pointerDown(toolbar)
    pointerUp()
    expect(executed).toHaveLength(0)

    // The flag is per gesture: a later pointerup without a text pointerdown still commits nothing.
    pointerUp()
    expect(executed).toHaveLength(0)
  })

  it('a right-button gesture (temporary eraser) never commits a highlight', () => {
    const a = layer(0, [{ text: 'Hello', rect: [10, 100, 50, 110] }])
    cleanup.push(a.unregister)
    const { executed, handler } = setup()
    cleanup.push(() => handler.onDeactivate!())

    a.el.firstChild!.dispatchEvent(new MouseEvent('pointerdown', { button: 2, bubbles: true }))
    select(a.el.firstChild!.firstChild!, 0, a.el.firstChild!.firstChild!, 5)
    window.dispatchEvent(new MouseEvent('pointerup', { button: 2 }))
    expect(executed).toHaveLength(0)
  })

  it('does nothing in freehand mode or after deactivation', () => {
    const a = layer(0, [{ text: 'Hello', rect: [10, 100, 50, 110] }])
    cleanup.push(a.unregister)
    const free = setup({ ...textSettings, mode: 'freehand' })
    pointerDown(a.el.firstChild as Element)
    select(a.el.firstChild!.firstChild!, 0, a.el.firstChild!.firstChild!, 5)
    pointerUp()
    expect(free.executed).toHaveLength(0)
    free.handler.onDeactivate!()

    const text = setup()
    text.handler.onDeactivate!()
    pointerUp()
    expect(text.executed).toHaveLength(0)
  })

  it('textSelection exposes the colour only in text mode', () => {
    const t = setup()
    const f = setup({ ...textSettings, mode: 'freehand' })
    cleanup.push(() => t.handler.onDeactivate!(), () => f.handler.onDeactivate!())
    expect(t.handler.textSelection!()).toEqual({ color: [0.094, 1, 1] })
    expect(f.handler.textSelection!()).toBeNull()
  })
})

describe('marker text mode fallback (page without text)', () => {
  function ev(pdf: Point): PagePointerEvent {
    return { page: 2, pdf, screen: [0, 0], vp: { scale: 1 } as never, native: {} as PointerEvent, toPdf: (x, y) => [x, y] }
  }

  beforeEach(() => {
    delete appSettings.data.hints.markerFallback
  })
  afterEach(() => {
    delete appSettings.data.hints.markerFallback
  })

  it('draws freehand, shows the hint once and persists it', () => {
    const show = vi.spyOn(toasts, 'show').mockReturnValue(0)
    // Persistence itself is covered by the settings store tests.
    const setHint = vi.spyOn(appSettings, 'setHint').mockImplementation((key) => {
      appSettings.data.hints[key] = true
    })
    const { executed, handler, committed } = setup()
    cleanup.push(() => handler.onDeactivate!())

    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerMove!(ev([5, 5]))
    handler.onPointerUp!(ev([10, 0]))
    expect(executed).toHaveLength(1)
    expect(committed()[0]).toMatchObject({ kind: 'ink', role: 'marker', blend: 'multiply', page: 2 })
    expect(show).toHaveBeenCalledExactlyOnceWith(FALLBACK_MESSAGE)
    expect(setHint).toHaveBeenCalledWith('markerFallback')
    expect(appSettings.data.hints.markerFallback).toBe(true)

    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerUp!(ev([0, 0]))
    expect(show).toHaveBeenCalledOnce()
  })

  it('stays silent when the hint was already shown in an earlier run', () => {
    appSettings.data.hints.markerFallback = true
    const show = vi.spyOn(toasts, 'show').mockReturnValue(0)
    const { handler } = setup()
    cleanup.push(() => handler.onDeactivate!())
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerCancel!(ev([0, 0]))
    expect(show).not.toHaveBeenCalled()
  })

  it('freehand mode never shows the hint', () => {
    const show = vi.spyOn(toasts, 'show').mockReturnValue(0)
    const { handler } = setup({ ...textSettings, mode: 'freehand' })
    cleanup.push(() => handler.onDeactivate!())
    handler.onPointerDown!(ev([0, 0]))
    handler.onPointerCancel!(ev([0, 0]))
    expect(show).not.toHaveBeenCalled()
  })
})

describe('marker text mode on a page with text: per press', () => {
  /** "Hello" in a page wrapper beside an overlay stand-in (like PageView). */
  function page() {
    const wrap = document.createElement('div')
    document.body.append(wrap)
    const a = layer(0, [{ text: 'Hello', rect: [10, 100, 60, 110] }])
    cleanup.push(a.unregister)
    const overlay = document.createElement('div')
    wrap.append(a.el, overlay)
    return overlay
  }
  /** A press-shaped event on the overlay at client (x, y); PDF y = 1000 - y as in layer(). */
  function at(overlay: Element, x: number, y: number): PagePointerEvent {
    const native = { target: overlay, clientX: x, clientY: y, pointerType: 'mouse' } as unknown as PointerEvent
    const toPdf = (cx: number, cy: number): Point => [cx, 1000 - cy]
    return { page: 0, pdf: toPdf(x, y), screen: [x, y], vp: { scale: 1 } as never, native, toPdf }
  }

  beforeEach(() => {
    delete appSettings.data.hints.markerFallback
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const [left, top, right, bottom] = (this as HTMLElement).dataset?.rect?.split(',').map(Number) ?? [0, 0, 0, 0]
      return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top } as DOMRect
    })
  })
  afterEach(() => {
    delete appSettings.data.hints.markerFallback
  })

  it('lets input through to the text near text only, and never in freehand mode', () => {
    const overlay = page()
    const text = setup()
    const free = setup({ ...textSettings, mode: 'freehand' })
    cleanup.push(() => text.handler.onDeactivate!(), () => free.handler.onDeactivate!())
    expect(text.handler.passThroughAt!(at(overlay, 30, 105))).toBe(true)
    expect(text.handler.passThroughAt!(at(overlay, 30, 150))).toBe(false)
    expect(free.handler.passThroughAt!(at(overlay, 30, 105))).toBe(false)
  })

  it('a press in blank space draws a marker stroke without the no-text hint', () => {
    const show = vi.spyOn(toasts, 'show').mockReturnValue(0)
    const overlay = page()
    const { executed, handler, committed } = setup()
    cleanup.push(() => handler.onDeactivate!())
    handler.onPointerDown!(at(overlay, 30, 150))
    handler.onPointerMove!(at(overlay, 40, 160))
    handler.onPointerUp!(at(overlay, 50, 150))
    expect(executed).toHaveLength(1)
    expect(committed()[0]).toMatchObject({ kind: 'ink', role: 'marker', page: 0 })
    expect(show).not.toHaveBeenCalled()
  })

  it('a press near text the overlay took draws nothing (the text drag takes it)', () => {
    const overlay = page()
    const { executed, handler } = setup()
    cleanup.push(() => handler.onDeactivate!())
    handler.onPointerDown!(at(overlay, 30, 105))
    handler.onPointerMove!(at(overlay, 50, 105))
    handler.onPointerUp!(at(overlay, 55, 105))
    expect(executed).toHaveLength(0)
  })
})
