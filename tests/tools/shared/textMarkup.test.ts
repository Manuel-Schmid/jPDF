import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Point } from '../../../src/core/session/model'
import { registerTextLayer } from '../../../src/core/viewer/textLayers'
import { trackPen } from '../../../src/core/viewer/Overlay.svelte'
import { listenForTextSelection, trimTrailingWhitespace, type Ranges } from '../../../src/tools/shared/textMarkup'

let cleanup: (() => void)[] = []

afterEach(() => {
  cleanup.forEach((f) => f())
  cleanup = []
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function pointer(type: string, x: number, y: number, timeStamp: number, pointerType = 'mouse', pointerId = 1) {
  const e = new MouseEvent(type, {
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  Object.defineProperty(e, 'pointerId', { value: pointerId })
  Object.defineProperty(e, 'timeStamp', { value: timeStamp })
  return e as PointerEvent
}

describe('trimTrailingWhitespace', () => {
  it('trims trailing space and tab in a single text node without mutating the original range', () => {
    const div = document.createElement('div')
    const text = document.createTextNode('hello  \tworld ')
    div.append(text)
    document.body.append(div)

    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8) // "hello  \t"

    const trimmed = trimTrailingWhitespace(range)
    expect(trimmed.toString()).toBe('hello')
    expect(range.toString()).toBe('hello  \t')
  })

  it('leaves a range without trailing whitespace unchanged', () => {
    const div = document.createElement('div')
    const text = document.createTextNode('hello world')
    div.append(text)
    document.body.append(div)

    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)

    expect(trimTrailingWhitespace(range).toString()).toBe('hello')
  })

  it('trims across a trailing whitespace-only span and when endContainer is an element', () => {
    const div = document.createElement('div')
    const s1 = document.createElement('span')
    s1.textContent = 'hello '
    const s2 = document.createElement('span')
    s2.textContent = '   '
    div.append(s1, s2)
    document.body.append(div)

    const acrossSpans = document.createRange()
    acrossSpans.setStart(s1.firstChild!, 0)
    acrossSpans.setEnd(s2.firstChild!, 2)
    expect(trimTrailingWhitespace(acrossSpans).toString()).toBe('hello')

    const elemEnd = document.createRange()
    elemEnd.setStart(s1.firstChild!, 0)
    elemEnd.setEnd(div, 2)
    expect(trimTrailingWhitespace(elemEnd).toString()).toBe('hello')
  })

  it('collapses a range containing only whitespace', () => {
    const div = document.createElement('div')
    const text = document.createTextNode('   ')
    div.append(text)
    document.body.append(div)

    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 3)

    const trimmed = trimTrailingWhitespace(range)
    expect(trimmed.collapsed).toBe(true)
    expect(trimmed.toString()).toBe('')
  })
})

describe('listenForTextSelection multi-click trimming', () => {
  function setupLayer() {
    const el = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = 'hello world'
    el.append(span)
    document.body.append(el)
    const toPdf = (x: number, y: number): Point => [x, 1000 - y]
    cleanup.push(registerTextLayer(el, { page: 0, toPdf }))
    return { el, text: span.firstChild as Text }
  }

  it('trims trailing space on double-click commit and preview', () => {
    const { el, text } = setupLayer()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const committed: string[] = []
    const previews: string[] = []
    cleanup.push(
      listenForTextSelection(
        (sel) => {
          committed.push(sel.toString())
          return true
        },
        (sel: Ranges | null) => {
          if (sel && sel.rangeCount > 0) previews.push(sel.getRangeAt(0).toString())
        },
      ),
    )

    // First click
    el.dispatchEvent(pointer('pointerdown', 20, 105, 100))
    window.dispatchEvent(pointer('pointerup', 20, 105, 120))

    // Second click within 500ms & 6px: browser selects "hello "
    el.dispatchEvent(pointer('pointerdown', 21, 105, 250))
    const r = document.createRange()
    r.setStart(text, 0)
    r.setEnd(text, 6) // "hello "
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
    frames.shift()?.(0)

    window.dispatchEvent(pointer('pointerup', 21, 105, 270))

    expect(previews).toEqual(['hello'])
    expect(committed).toEqual(['hello'])
  })

  it('preserves trailing space on a single-click selection', () => {
    const { el, text } = setupLayer()
    const committed: string[] = []
    cleanup.push(
      listenForTextSelection((sel) => {
        committed.push(sel.toString())
        return true
      }),
    )

    el.dispatchEvent(pointer('pointerdown', 20, 105, 100))
    const r = document.createRange()
    r.setStart(text, 0)
    r.setEnd(text, 6) // "hello "
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    window.dispatchEvent(pointer('pointerup', 80, 105, 300))

    expect(committed).toEqual(['hello '])
  })
})

describe('listenForTextSelection with a pen', () => {
  function setup() {
    const el = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = 'hello world'
    el.append(span)
    document.body.append(el)
    const toPdf = (x: number, y: number): Point => [x, 1000 - y]
    cleanup.push(registerTextLayer(el, { page: 0, toPdf }))
    const committed: string[] = []
    cleanup.push(
      listenForTextSelection((sel) => {
        committed.push(sel.toString())
        return true
      }),
    )
    const text = span.firstChild as Text
    /** The selection the drag has made so far: "hello" plus `extra` characters. */
    const select = (end: number) => {
      const r = document.createRange()
      r.setStart(text, 0)
      r.setEnd(text, end)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(r)
    }
    return { el, committed, select }
  }

  it('a palm landing mid-drag neither ends the drag nor commits part of it', () => {
    const { el, committed, select } = setup()
    cleanup.push(trackPen(() => {}))
    el.dispatchEvent(pointer('pointerdown', 10, 105, 100, 'pen', 7))
    select(5)
    // The palm comes down, and lifts again, while the pen keeps dragging.
    el.dispatchEvent(pointer('pointerdown', 300, 400, 150, 'touch', 9))
    window.dispatchEvent(pointer('pointerup', 300, 400, 200, 'touch', 9))
    expect(committed).toEqual([])
    select(11)
    window.dispatchEvent(pointer('pointerup', 110, 105, 300, 'pen', 7))
    expect(committed).toEqual(['hello world'])
  })

  it("only the pressing pointer's release ends the gesture", () => {
    const { el, committed, select } = setup()
    el.dispatchEvent(pointer('pointerdown', 10, 105, 100, 'pen', 7))
    select(5)
    window.dispatchEvent(pointer('pointerup', 0, 0, 150, 'mouse', 1))
    window.dispatchEvent(pointer('pointercancel', 0, 0, 160, 'touch', 9))
    expect(committed).toEqual([])
    window.dispatchEvent(pointer('pointerup', 50, 105, 200, 'pen', 7))
    expect(committed).toEqual(['hello'])
  })

  it('a pen drag the browser cancels commits what it had selected', () => {
    const { el, committed, select } = setup()
    el.dispatchEvent(pointer('pointerdown', 10, 105, 100, 'pen', 7))
    select(5)
    window.dispatchEvent(pointer('pointercancel', 50, 105, 200, 'pen', 7))
    expect(committed).toEqual(['hello'])
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  it('another cancelled gesture leaves no native selection behind', () => {
    const { el, committed, select } = setup()
    el.dispatchEvent(pointer('pointerdown', 10, 105, 100, 'mouse', 1))
    select(5)
    window.dispatchEvent(pointer('pointercancel', 50, 105, 200, 'mouse', 1))
    expect(committed).toEqual([])
    expect(window.getSelection()!.rangeCount === 0 || window.getSelection()!.isCollapsed).toBe(true)
  })
})
