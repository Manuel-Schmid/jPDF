import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Point } from '../../../src/core/session/model'
import { settings } from '../../../src/core/settings/settings.svelte'
import { cancelTouchGestures } from '../../../src/core/viewer/Overlay.svelte'
import { registerTextLayer, textLayerFor } from '../../../src/core/viewer/textLayers'
import { textReach } from '../../../src/tools/shared/textDrag'
import { listenForTextSelection } from '../../../src/tools/shared/textMarkup'

/**
 * Text layers whose spans carry their client rect in a data attribute;
 * characters are equally wide within a span (Range rects are stubbed).
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
  const toPdf = (x: number, y: number): Point => [x, 1000 - y]
  cleanup.push(registerTextLayer(el, { page, toPdf }))
  return el
}

const rectOf = (left: number, top: number, right: number, bottom: number) =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  }) as DOMRect

const spanRect = (span: Element | null | undefined) => {
  const r = (span as HTMLElement | null)?.dataset?.rect
  return r ? (r.split(',').map(Number) as [number, number, number, number]) : null
}

function pointer(
  type: string,
  x: number,
  y: number,
  init: { pointerType?: string; shiftKey?: boolean } = {},
) {
  const e = new MouseEvent(type, {
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    shiftKey: init.shiftKey,
  })
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e as PointerEvent
}

/** A press at (x, y) on `target`; returns the event (defaultPrevented = taken over). */
function press(target: Element, x: number, y: number, init?: Parameters<typeof pointer>[3]) {
  const e = pointer('pointerdown', x, y, init)
  target.dispatchEvent(e)
  return e
}
const release = (x: number, y: number) => window.dispatchEvent(pointer('pointerup', x, y))

let cleanup: (() => void)[] = []
const committed: string[] = []

function listen() {
  cleanup.push(
    listenForTextSelection((sel) => {
      committed.push(sel.toString())
      return true
    }),
  )
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const r = spanRect(this)
    return r ? rectOf(...r) : rectOf(0, 0, 0, 0)
  })
  Range.prototype.getBoundingClientRect = function (this: Range) {
    const node = this.startContainer
    const r = spanRect(node.parentElement)
    if (!r || !(node instanceof Text)) return rectOf(0, 0, 0, 0)
    const w = (r[2] - r[0]) / node.length
    return rectOf(r[0] + this.startOffset * w, r[1], r[0] + this.endOffset * w, r[3])
  }
})

afterEach(() => {
  settings.setPreference('drawWithFinger', false)
  cleanup.forEach((f) => f())
  cleanup = []
  committed.length = 0
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** "Hello world" (10 px per character) above "second line", 10 px gap. */
function twoLines() {
  return layer(0, [
    { text: 'Hello ', rect: [10, 100, 70, 110] },
    { text: 'world', rect: [70, 100, 120, 110] },
    { text: 'second line', rect: [10, 120, 120, 130] },
  ])
}

describe('dragging out a text selection', () => {
  it('a press a few px left of the first glyph starts at the line start', () => {
    const el = twoLines()
    listen()
    expect(press(el, 5, 105).defaultPrevented).toBe(true)
    release(96, 105)
    expect(committed).toEqual(['Hello wor'])
  })

  it('a press up to 12 px left of the text still starts (further than above/below)', () => {
    const el = twoLines()
    listen()
    expect(press(el, -1, 105).defaultPrevented).toBe(true)
    release(46, 105)
    expect(committed).toEqual(['Hell'])
  })

  it('a press in the gap just below a line starts on that line', () => {
    const el = twoLines()
    listen()
    press(el, 40, 112)
    release(120, 105)
    expect(committed).toEqual(['lo world'])
  })

  it('straying a little below the line keeps the selection on it', () => {
    const el = twoLines()
    listen()
    press(el, 10, 105)
    release(96, 114)
    expect(committed).toEqual(['Hello wor'])
  })

  it('moving clearly onto the next line follows it', () => {
    const el = twoLines()
    listen()
    press(el, 10, 105)
    release(36, 125)
    expect(committed).toEqual(['Hello worldsec'])
  })

  it('dragging past the end of the text stops at the last line', () => {
    const el = twoLines()
    listen()
    press(el, 10, 105)
    release(500, 400)
    expect(committed).toEqual(['Hello worldsecond line'])
  })

  it('a drag backwards selects from the press to the pointer', () => {
    const el = twoLines()
    listen()
    press(el, 96, 125)
    release(64, 106)
    expect(committed).toEqual([' worldsecond li'])
  })

  it('moves are applied once per frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const el = twoLines()
    listen()
    press(el, 10, 105)
    window.dispatchEvent(pointer('pointermove', 46, 104))
    expect(window.getSelection()!.toString()).toBe('')
    frames.shift()!(0)
    expect(window.getSelection()!.toString()).toBe('Hell')
  })

  it('a press further from text than the tolerance is left to the browser', () => {
    const el = twoLines()
    listen()
    expect(press(el, 30, 160).defaultPrevented).toBe(false)
    release(96, 105)
    expect(committed).toEqual([])
  })

  it('touch, Shift+click and double clicks keep the native selection', () => {
    const el = twoLines()
    listen()
    expect(press(el, 30, 105, { pointerType: 'touch' }).defaultPrevented).toBe(false)
    release(30, 105)
    expect(press(el, 200, 300).defaultPrevented).toBe(false) // far away: resets the click count
    release(200, 300)
    expect(press(el, 30, 105, { shiftKey: true }).defaultPrevented).toBe(false)
    release(30, 105)
    // The press right after the Shift+click is its second click.
    expect(press(el, 31, 105).defaultPrevented).toBe(false)
    release(31, 105)
  })

  it('continues onto the next page', () => {
    const a = twoLines()
    layer(1, [{ text: 'next page', rect: [10, 400, 100, 410] }])
    listen()
    press(a, 60, 125)
    // Page 1's layer box is the stubbed zero rect: entered only via its own rect.
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      const r = spanRect(this)
      if (r) return rectOf(...r)
      return this === document.body.lastElementChild ? rectOf(0, 390, 200, 420) : rectOf(0, 0, 0, 0)
    })
    release(46, 405)
    expect(committed).toEqual(['d linenext'])
  })

  it('touch drags text only when drawWithFinger is enabled and discards on cancelTouchGestures', () => {
    const el = twoLines()
    listen()
    // Off by default: touch is ignored.
    expect(press(el, 10, 105, { pointerType: 'touch' }).defaultPrevented).toBe(false)
    release(96, 105)
    expect(committed).toEqual([])

    // On: touch drags out a selection and commits on release.
    settings.setPreference('drawWithFinger', true)
    expect(press(el, 20, 105, { pointerType: 'touch' }).defaultPrevented).toBe(true)
    release(96, 105)
    expect(committed).toEqual(['ello wor'])

    // Two-finger pinch cancels the active touch text drag without committing.
    committed.length = 0
    expect(press(el, 35, 105, { pointerType: 'touch' }).defaultPrevented).toBe(true)
    cancelTouchGestures()
    release(96, 105)
    expect(committed).toEqual([])
  })
})

describe('textReach (is a press within reach of text?)', () => {
  const info = { page: 0, toPdf: (x: number, y: number): Point => [x, 1000 - y] }

  it('is near on a glyph and within the start area, far just outside it', () => {
    const el = twoLines()
    expect(textReach(el, info, 30, 105)).toBe('near')
    // 7 px below "second line" (bottom 130), 11 px left of the text (left 10).
    expect(textReach(el, info, 30, 137)).toBe('near')
    expect(textReach(el, info, -1, 105)).toBe('near')
    // 9 px below, 13 px left: outside START_TOLERANCE_PX / START_TOLERANCE_X_PX.
    expect(textReach(el, info, 30, 139)).toBe('far')
    expect(textReach(el, info, -3, 105)).toBe('far')
  })

  it('is none for a layer without text', () => {
    const el = layer(0, [])
    expect(textReach(el, info, 30, 105)).toBe('none')
  })
})

describe('textLayerFor', () => {
  /** A page wrapper holding a text layer and an overlay stand-in, like PageView. */
  function page(n: number) {
    const wrap = document.createElement('div')
    document.body.append(wrap)
    const el = layer(n, [{ text: 'x', rect: [0, 0, 10, 10] }])
    const overlay = document.createElement('svg')
    wrap.append(el, overlay)
    return { el, overlay }
  }

  it('finds the layer from a sibling in the same page', () => {
    const { el, overlay } = page(0)
    expect(textLayerFor(overlay)?.[0]).toBe(el)
    expect(textLayerFor(el.firstChild!)?.[0]).toBe(el)
  })

  it('picks the right one of two layers of the same page number', () => {
    page(3)
    const b = page(3)
    expect(textLayerFor(b.overlay)?.[0]).toBe(b.el)
  })

  it('is null outside any page with a text layer', () => {
    page(0)
    const loose = document.createElement('div')
    document.body.append(loose)
    expect(textLayerFor(loose)).toBeNull()
  })
})

describe('a press the overlay took (beside the text layer in the same page)', () => {
  /** "Hello world" in a page wrapper next to an overlay stand-in. */
  function pageWithOverlay() {
    const wrap = document.createElement('div')
    document.body.append(wrap)
    const el = layer(0, [
      { text: 'Hello ', rect: [10, 100, 70, 110] },
      { text: 'world', rect: [70, 100, 120, 110] },
    ])
    const overlay = document.createElement('div')
    wrap.append(el, overlay)
    return overlay
  }

  it('near text: starts the drag at the nearest character and commits on release', () => {
    const overlay = pageWithOverlay()
    listen()
    expect(press(overlay, 7, 105, { pointerType: 'pen' }).defaultPrevented).toBe(true)
    release(46, 105)
    expect(committed).toEqual(['Hell'])
  })

  it('away from text: no selection and nothing committed', () => {
    const overlay = pageWithOverlay()
    listen()
    expect(press(overlay, 30, 140, { pointerType: 'pen' }).defaultPrevented).toBe(false)
    release(46, 105)
    expect(committed).toEqual([])
    expect(window.getSelection()!.toString()).toBe('')
  })

  it('an inactive listener (marker in freehand mode) leaves the press to the overlay', () => {
    const overlay = pageWithOverlay()
    cleanup.push(
      listenForTextSelection(
        (sel) => {
          committed.push(sel.toString())
          return true
        },
        undefined,
        () => false,
      ),
    )
    expect(press(overlay, 7, 105, { pointerType: 'pen' }).defaultPrevented).toBe(false)
    release(46, 105)
    expect(committed).toEqual([])
  })
})
