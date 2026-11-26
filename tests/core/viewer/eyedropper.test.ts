import { fireEvent, render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import type { ToolHandler } from '../../../src/core/registry/tools'
import type { Annotation, InkAnnotation, RGB } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay from '../../../src/core/viewer/Overlay.svelte'
import {
  annotationColor, cancelPick, canvasColorAt, eyedropper, pickColor, registerColorSource,
} from '../../../src/core/viewer/eyedropper.svelte'
import { dismissable } from '../../../src/ui/dismissable'

const rectOf = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect

/** An element at the given client rect, registered as a colour source. */
function source(fn: (x: number, y: number) => RGB | null, rect = rectOf(0, 0, 100, 100)) {
  const el = document.createElement('div')
  document.body.append(el)
  el.getBoundingClientRect = () => rect
  const stop = registerColorSource(el, fn)
  return { el, stop }
}

const down = (target: EventTarget, init: PointerEventInit = {}) => {
  const e = new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

afterEach(() => {
  cancelPick()
  document.body.innerHTML = ''
})

describe('pickColor', () => {
  it('takes the colour under a press on a page and swallows the press', async () => {
    const { el, stop } = source(() => [1, 0, 0])
    const pageListener = vi.fn()
    el.addEventListener('pointerdown', pageListener)
    const picked = pickColor()
    expect(eyedropper.active).toBe(true)
    expect(document.documentElement.hasAttribute('data-eyedropper')).toBe(true)
    const e = down(el)
    await expect(picked).resolves.toEqual([1, 0, 0])
    expect(e.defaultPrevented).toBe(true)
    expect(pageListener).not.toHaveBeenCalled()
    expect(eyedropper.active).toBe(false)
    expect(document.documentElement.hasAttribute('data-eyedropper')).toBe(false)
    stop()
  })

  it('Escape cancels', async () => {
    const picked = pickColor()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await expect(picked).resolves.toBeNull()
    expect(eyedropper.active).toBe(false)
  })

  it('a press outside the pages cancels and goes through', async () => {
    const { stop } = source(() => [1, 0, 0], rectOf(0, 0, 100, 100))
    const picked = pickColor()
    const e = down(document.body, { clientX: 300, clientY: 300 })
    await expect(picked).resolves.toBeNull()
    expect(e.defaultPrevented).toBe(false)
    stop()
  })

  it('stays on when the page has no colour there, and ignores the eyedropper button', async () => {
    let colour: RGB | null = null
    const { el, stop } = source(() => colour)
    const button = document.createElement('button')
    button.setAttribute('data-eyedropper-ignore', '')
    document.body.append(button)
    const picked = pickColor()
    down(el)
    down(button)
    expect(eyedropper.active).toBe(true)
    colour = [0, 1, 0]
    down(el)
    await expect(picked).resolves.toEqual([0, 1, 0])
    stop()
  })

  it('a new pick cancels the previous one', async () => {
    const first = pickColor()
    const second = pickColor()
    await expect(first).resolves.toBeNull()
    expect(eyedropper.active).toBe(true)
    cancelPick()
    await expect(second).resolves.toBeNull()
  })

  it('Escape while picking leaves an open popup open', async () => {
    const popup = document.createElement('div')
    document.body.append(popup)
    const onclose = vi.fn()
    const action = dismissable(popup, { onclose })
    const picked = pickColor()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await expect(picked).resolves.toBeNull()
    expect(onclose).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(onclose).toHaveBeenCalledOnce()
    action.destroy()
  })

  it('a pick on the page does not close an open popup', async () => {
    const { el, stop } = source(() => [0, 0, 1])
    const popup = document.createElement('div')
    document.body.append(popup)
    const onclose = vi.fn()
    const action = dismissable(popup, { onclose })
    const picked = pickColor()
    down(el)
    await expect(picked).resolves.toEqual([0, 0, 1])
    expect(onclose).not.toHaveBeenCalled()
    action.destroy()
    stop()
  })
})

describe('annotationColor', () => {
  const base = { id: 'a', page: 0, sourceRef: null, modifiedAt: '', author: '' }
  it('is the stored main colour of each kind', () => {
    const red: RGB = [1, 0, 0]
    const blue: RGB = [0, 0, 1]
    const cases: [Annotation, RGB | null][] = [
      [{ ...base, kind: 'highlight', quads: [], color: red, opacity: 0.4 }, red],
      [{ ...base, kind: 'underline', quads: [], color: red }, red],
      [{ ...base, kind: 'ink', strokes: [], color: red, width: 1, opacity: 1, blend: 'normal', role: 'pen' }, red],
      [{ ...base, kind: 'freetext', rect: [0, 0, 1, 1], text: '', lines: [], fontSize: 12, textColor: red, background: { color: blue, opacity: 1 }, align: 'left' }, red],
      [{ ...base, kind: 'shape', shape: 'rect', rect: [0, 0, 1, 1], border: { color: red, width: 1, opacity: 1 }, fill: { color: blue, opacity: 1 } } as Annotation, red],
      [{ ...base, kind: 'shape', shape: 'rect', rect: [0, 0, 1, 1], border: null, fill: { color: blue, opacity: 1 } } as Annotation, blue],
      [{ ...base, kind: 'image', rect: [0, 0, 1, 1], image: { width: 1, height: 1, png: '' } }, null],
    ]
    for (const [a, c] of cases) expect(annotationColor(a)).toEqual(c)
  })
})

describe('canvasColorAt', () => {
  function canvas(pixel: number[]) {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 200
    c.getBoundingClientRect = () => rectOf(10, 20, 200, 100)
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(pixel) }))
    c.getContext = vi.fn(() => ({ getImageData })) as unknown as HTMLCanvasElement['getContext']
    return { c, getImageData }
  }

  it('reads one pixel at the canvas resolution', () => {
    const { c, getImageData } = canvas([255, 0, 0, 255])
    expect(canvasColorAt(c, 60, 45)).toEqual([1, 0, 0])
    expect(getImageData).toHaveBeenCalledWith(100, 50, 1, 1)
  })

  it('composites a transparent pixel on white', () => {
    const { c } = canvas([0, 0, 0, 0])
    expect(canvasColorAt(c, 60, 45)).toEqual([1, 1, 1])
  })

  it('is null outside the canvas', () => {
    const { c } = canvas([0, 0, 0, 255])
    expect(canvasColorAt(c, 5, 45)).toBeNull()
  })
})

describe('Overlay as a colour source', () => {
  // Page 100pt tall at scale 2.
  const vp = {
    scale: 2,
    width: 200,
    height: 200,
    convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
    convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
  } as unknown as PageViewport

  const ink: InkAnnotation = {
    id: 'i', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
    strokes: [[[10, 50], [90, 50]]], color: [0.2, 0.4, 0.6], width: 2, opacity: 0.5, blend: 'multiply', role: 'marker',
  }

  function mount() {
    const store = new AnnotationStore()
    store.add(ink)
    const onPointerDown = vi.fn()
    const tool: ToolHandler = { onPointerDown }
    const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, tool } })
    const svg = r.container.querySelector('svg')!
    svg.getBoundingClientRect = () => rectOf(0, 0, 200, 200)
    svg.setPointerCapture = vi.fn()
    return { svg, onPointerDown }
  }

  it("takes a hit annotation's exact stored colour, not the tool's press", async () => {
    const { svg, onPointerDown } = mount()
    const picked = pickColor()
    // PDF (50, 50) is at client (100, 100).
    await fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 101, pointerId: 1 })
    await expect(picked).resolves.toEqual([0.2, 0.4, 0.6])
    expect(onPointerDown).not.toHaveBeenCalled()
  })

  it('takes the paper colour away from annotations on a page without a canvas', async () => {
    const { svg } = mount()
    const picked = pickColor()
    await fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 20, pointerId: 1 })
    await expect(picked).resolves.toEqual([1, 1, 1])
  })
})
