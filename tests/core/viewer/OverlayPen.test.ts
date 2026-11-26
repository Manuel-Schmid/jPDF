import { fireEvent, render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import type { PagePointerEvent, ToolHandler } from '../../../src/core/registry/tools'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay, { cancelTouchGestures } from '../../../src/core/viewer/Overlay.svelte'
import { registerTextLayer } from '../../../src/core/viewer/textLayers'

// Page 100pt tall at scale 2.
const vp = {
  scale: 2,
  rotation: 0,
  width: 200,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

function spy() {
  const events: [string, PagePointerEvent][] = []
  const handler: ToolHandler = {
    onPointerDown: (e) => void events.push(['down', e]),
    onPointerMove: (e) => void events.push(['move', e]),
    onPointerUp: (e) => void events.push(['up', e]),
    onPointerCancel: (e) => void events.push(['cancel', e]),
  }
  return { handler, events, kinds: () => events.map(([k]) => k) }
}

function mount(props: Record<string, unknown>) {
  const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store: new AnnotationStore(), viewport: vp, cursor: 'copy', ...props } })
  const svg = r.container.querySelector('svg')!
  const page = svg.parentElement!
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect
  const captured = new Set<number>()
  svg.setPointerCapture = vi.fn((id: number) => void captured.add(id))
  svg.releasePointerCapture = vi.fn((id: number) => void captured.delete(id))
  svg.hasPointerCapture = (id: number) => captured.has(id)
  // Stand-in for the text layer under the overlay.
  const text = document.createElement('div')
  page.append(text)
  return { ...r, svg, page, text }
}

/** The pen's eraser end: button 5 on down, buttons bit 32 while down. */
const eraserEnd = (over: Record<string, unknown> = {}) => ({
  pointerType: 'pen', button: 5, buttons: 32, pointerId: 7, clientX: 20, clientY: 20, ...over,
})
const touch = (over: Record<string, unknown> = {}) => ({
  pointerType: 'touch', button: 0, buttons: 1, pointerId: 3, clientX: 40, clientY: 40, ...over,
})
const mouse = (over: Record<string, unknown> = {}) => ({
  pointerType: 'mouse', button: 0, buttons: 1, pointerId: 1, clientX: 40, clientY: 40, ...over,
})

/** A pen hovering over the window (any element: listened to on window). */
function penHover(type = 'pointermove', over: Record<string, unknown> = {}) {
  document.body.dispatchEvent(new PointerEvent(type, { pointerType: 'pen', pointerId: 9, buttons: 0, bubbles: true, ...over }))
}

afterEach(() => vi.restoreAllMocks())

describe('Overlay: pen eraser end', () => {
  it('erases with the pen eraser, whatever the tool, not reaching the tool or the right-button eraser', async () => {
    const tool = spy()
    const eraser = spy()
    const penEraser = spy()
    const { svg, page } = mount({ tool: tool.handler, eraser: eraser.handler, penEraser: penEraser.handler })
    const down = new PointerEvent('pointerdown', { ...eraserEnd(), bubbles: true, cancelable: true })
    page.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(svg.setPointerCapture).toHaveBeenCalledWith(7)
    await tick()
    expect(svg.style.cursor).toBe('crosshair')
    await fireEvent.pointerMove(svg, eraserEnd({ button: -1, clientX: 40 }))
    await fireEvent.pointerUp(svg, eraserEnd({ buttons: 0, clientX: 40 }))
    expect(penEraser.kinds()).toEqual(['down', 'move', 'up'])
    expect(penEraser.events[0][1].pdf).toEqual([10, 90])
    expect(tool.events).toEqual([])
    expect(eraser.events).toEqual([])
    expect(svg.style.cursor).toBe('copy')
  })

  it('works without a tool and without the right-button eraser (e.g. select or hand)', async () => {
    const penEraser = spy()
    const { svg } = mount({ tool: null, eraser: null, penEraser: penEraser.handler })
    await fireEvent.pointerDown(svg, eraserEnd())
    await fireEvent.pointerUp(svg, eraserEnd({ buttons: 0 }))
    expect(penEraser.kinds()).toEqual(['down', 'up'])
  })

  it('without a pen eraser the eraser end does nothing', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler })
    await fireEvent.pointerDown(svg, eraserEnd())
    await fireEvent.pointerUp(svg, eraserEnd({ buttons: 0 }))
    expect(tool.events).toEqual([])
  })

  it('the barrel button still acts as the right button (temporary eraser)', async () => {
    const eraser = spy()
    const penEraser = spy()
    const { svg } = mount({ tool: null, eraser: eraser.handler, penEraser: penEraser.handler })
    await fireEvent.pointerDown(svg, { pointerType: 'pen', button: 2, buttons: 2, pointerId: 7, clientX: 20, clientY: 20 })
    await fireEvent.pointerUp(svg, { pointerType: 'pen', button: 2, buttons: 0, pointerId: 7, clientX: 20, clientY: 20 })
    expect(eraser.kinds()).toEqual(['down', 'up'])
    expect(penEraser.events).toEqual([])
  })
  describe('with a text-selecting tool (marker text mode, underline, strike-out)', () => {
    const textTool = (): ToolHandler => ({ textSelection: () => ({ color: null }) })
    const side = (over: Record<string, unknown> = {}) => ({ pointerType: 'pen', button: 2, buttons: 2, pointerId: 7, clientX: 20, clientY: 20, ...over })

    it('the barrel button erases with the pen eraser, on the text too, and opens no page menu', async () => {
      const onpagemenu = vi.fn()
      const penEraser = spy()
      const { svg, page, text } = mount({ tool: textTool(), eraser: null, penEraser: penEraser.handler, onpagemenu })
      const unregister = registerTextLayer(text, { page: 0, toPdf: (x, y) => [x, y] })
      const bubbled = vi.fn()
      page.addEventListener('pointerdown', bubbled)
      await fireEvent.pointerDown(text, side())
      expect(bubbled).not.toHaveBeenCalled()
      await fireEvent.pointerMove(svg, side({ button: -1, clientX: 40 }))
      await fireEvent.pointerUp(svg, side({ buttons: 0, clientX: 40 }))
      expect(penEraser.kinds()).toEqual(['down', 'move', 'up'])
      await fireEvent.contextMenu(text, { clientX: 40, clientY: 20 })
      expect(onpagemenu).not.toHaveBeenCalled()
      unregister()
    })

    it('letting go of the barrel button with the tip still down ends the erase', async () => {
      const penEraser = spy()
      const { svg } = mount({ tool: textTool(), eraser: null, penEraser: penEraser.handler })
      await fireEvent.pointerDown(svg, side())
      await fireEvent.pointerMove(svg, side({ button: -1, buttons: 1, clientX: 40 }))
      expect(penEraser.kinds()).toEqual(['down', 'up'])
      // The barrel button's release brings a context menu: swallowed.
      expect(await fireEvent.contextMenu(svg, { clientX: 40, clientY: 20 })).toBe(false)
    })

    it('the mouse right button still unmarks on the text and opens the page menu on a click', async () => {
      const onpagemenu = vi.fn()
      const penEraser = spy()
      const { text } = mount({ tool: textTool(), eraser: null, penEraser: penEraser.handler, onpagemenu })
      const unregister = registerTextLayer(text, { page: 0, toPdf: (x, y) => [x, y] })
      await fireEvent.pointerDown(text, { button: 2, buttons: 2, pointerId: 1, clientX: 20, clientY: 20 })
      await fireEvent.pointerUp(text, { button: 2, buttons: 0, pointerId: 1, clientX: 20, clientY: 20 })
      expect(penEraser.events).toEqual([])
      await fireEvent.contextMenu(text, { clientX: 20, clientY: 20 })
      expect(onpagemenu).toHaveBeenCalledOnce()
      unregister()
    })
  })
})

describe('Overlay: pen buttons mapped in Settings', () => {
  const side = (over: Record<string, unknown> = {}) => ({ pointerType: 'pen', button: 2, buttons: 2, pointerId: 7, clientX: 20, clientY: 20, ...over })

  it('a button mapped to Lasso lassoes with the pen lasso, whatever the tool, with the lasso cursor', async () => {
    const tool = spy()
    const eraser = spy()
    const penEraser = spy()
    const penLasso = spy()
    const { svg, page } = mount({
      tool: tool.handler, eraser: eraser.handler, penEraser: penEraser.handler, penLasso: penLasso.handler,
      penButtons: { side: 'lasso', end: 'lasso' },
    })
    const down = new PointerEvent('pointerdown', { ...side(), bubbles: true, cancelable: true })
    page.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await tick()
    expect(svg.style.cursor).toBe('crosshair')
    await fireEvent.pointerMove(svg, side({ button: -1, clientX: 40 }))
    await fireEvent.pointerUp(svg, side({ buttons: 0, clientX: 40 }))
    // The eraser end too.
    await fireEvent.pointerDown(svg, eraserEnd())
    await fireEvent.pointerUp(svg, eraserEnd({ buttons: 0 }))
    expect(penLasso.kinds()).toEqual(['down', 'move', 'up', 'down', 'up'])
    expect(tool.events).toEqual([])
    expect(eraser.events).toEqual([])
    expect(penEraser.events).toEqual([])
    expect(svg.style.cursor).toBe('copy')
  })

  it('letting go of a side button mapped to Lasso with the tip still down ends the lasso, and no menu opens', async () => {
    const onpagemenu = vi.fn()
    const penLasso = spy()
    const { svg } = mount({ tool: null, penLasso: penLasso.handler, penButtons: { side: 'lasso', end: 'eraser' }, onpagemenu })
    await fireEvent.pointerDown(svg, side())
    await fireEvent.pointerMove(svg, side({ button: -1, buttons: 1, clientX: 40 }))
    expect(penLasso.kinds()).toEqual(['down', 'up'])
    expect(await fireEvent.contextMenu(svg, { clientX: 40, clientY: 20 })).toBe(false)
    expect(onpagemenu).not.toHaveBeenCalled()
  })

  it('a side button mapped to Eraser erases with the pen eraser with every tool, also those that open the page menu', async () => {
    const onpagemenu = vi.fn()
    const penEraser = spy()
    const { svg } = mount({ tool: spy().handler, eraser: null, penEraser: penEraser.handler, penButtons: { side: 'eraser', end: 'eraser' }, onpagemenu })
    await fireEvent.pointerDown(svg, side())
    await fireEvent.pointerUp(svg, side({ buttons: 0 }))
    expect(penEraser.kinds()).toEqual(['down', 'up'])
    await fireEvent.contextMenu(svg, { clientX: 20, clientY: 20 })
    expect(onpagemenu).not.toHaveBeenCalled()
  })

  it('a button mapped to Nothing does nothing: no tool, no eraser, no page menu', async () => {
    const onpagemenu = vi.fn()
    const tool = spy()
    const eraser = spy()
    const penEraser = spy()
    const { svg, page } = mount({
      tool: tool.handler, eraser: eraser.handler, penEraser: penEraser.handler, penButtons: { side: 'none', end: 'none' }, onpagemenu,
    })
    const bubbled = vi.fn()
    page.addEventListener('pointerdown', bubbled)
    await fireEvent.pointerDown(svg, side())
    await fireEvent.pointerUp(svg, side({ buttons: 0 }))
    await fireEvent.contextMenu(svg, { clientX: 20, clientY: 20 })
    await fireEvent.pointerDown(svg, eraserEnd({ button: 0 }))
    await fireEvent.pointerUp(svg, eraserEnd({ buttons: 0 }))
    expect(bubbled).not.toHaveBeenCalled()
    expect(tool.events).toEqual([])
    expect(eraser.events).toEqual([])
    expect(penEraser.events).toEqual([])
    expect(onpagemenu).not.toHaveBeenCalled()
  })

  it('the mouse right button is unaffected by the pen mapping', async () => {
    const eraser = spy()
    const penLasso = spy()
    const { svg } = mount({ tool: null, eraser: eraser.handler, penLasso: penLasso.handler, penButtons: { side: 'lasso', end: 'lasso' } })
    await fireEvent.pointerDown(svg, mouse({ button: 2, buttons: 2 }))
    await fireEvent.pointerUp(svg, mouse({ button: 2, buttons: 0 }))
    expect(eraser.kinds()).toEqual(['down', 'up'])
    expect(penLasso.events).toEqual([])
  })

  it('a press with the active tool reports itself (to drop the pen lasso selection); a pen-button press does not', async () => {
    const ontoolpress = vi.fn()
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, penLasso: spy().handler, penButtons: { side: 'lasso', end: 'eraser' }, ontoolpress })
    await fireEvent.pointerDown(svg, side())
    await fireEvent.pointerUp(svg, side({ buttons: 0 }))
    expect(ontoolpress).not.toHaveBeenCalled()
    await fireEvent.pointerDown(svg, mouse())
    expect(ontoolpress).toHaveBeenCalledOnce()
    expect(tool.kinds()).toEqual(['down'])
  })
})

describe('Overlay: draw with finger', () => {
  it('by default, touch does not reach the tool while pen and mouse do', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler })
    await fireEvent.pointerDown(svg, touch())
    await fireEvent.pointerUp(svg, touch({ buttons: 0 }))
    expect(tool.events).toEqual([])
    await fireEvent.pointerDown(svg, { pointerType: 'pen', button: 0, buttons: 1, pointerId: 9, clientX: 20, clientY: 20 })
    await fireEvent.pointerUp(svg, { pointerType: 'pen', button: 0, buttons: 0, pointerId: 9, clientX: 20, clientY: 20 })
    await fireEvent.pointerDown(svg, mouse())
    await fireEvent.pointerUp(svg, mouse({ buttons: 0 }))
    expect(tool.kinds()).toEqual(['down', 'up', 'down', 'up'])
  })

  it('when enabled, touch reaches the tool and cancelTouchGestures cancels an active touch stroke', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    await fireEvent.pointerDown(svg, touch())
    await fireEvent.pointerMove(svg, touch({ clientX: 60 }))
    cancelTouchGestures()
    expect(tool.kinds()).toEqual(['down', 'move', 'cancel'])
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(3)
  })
})

describe('Overlay: palm rejection', () => {
  it('without a pen, touch reaches the tool when drawWithFinger is enabled', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    await fireEvent.pointerDown(svg, touch())
    await fireEvent.pointerUp(svg, touch({ buttons: 0 }))
    expect(tool.kinds()).toEqual(['down', 'up'])
  })

  it('ignores touch while a pen is in range; the pen and the mouse still work', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    penHover('pointerover')
    await fireEvent.pointerDown(svg, touch())
    await fireEvent.pointerMove(svg, touch({ clientX: 60 }))
    await fireEvent.pointerUp(svg, touch({ buttons: 0 }))
    expect(tool.events).toEqual([])
    await fireEvent.pointerDown(svg, { pointerType: 'pen', button: 0, buttons: 1, pointerId: 9, clientX: 20, clientY: 20 })
    await fireEvent.pointerUp(svg, { pointerType: 'pen', button: 0, buttons: 0, pointerId: 9, clientX: 20, clientY: 20 })
    await fireEvent.pointerDown(svg, mouse())
    await fireEvent.pointerUp(svg, mouse({ buttons: 0 }))
    expect(tool.kinds()).toEqual(['down', 'up', 'down', 'up'])
  })

  it('accepts touch again once the pen leaves the window (out of hover range)', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    penHover()
    penHover('pointerout', { relatedTarget: null })
    await fireEvent.pointerDown(svg, touch())
    expect(tool.kinds()).toEqual(['down'])
  })

  it('moving between elements is not leaving range', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    penHover()
    penHover('pointerout', { relatedTarget: svg })
    await fireEvent.pointerDown(svg, touch())
    expect(tool.events).toEqual([])
  })

  it('accepts touch again when the pen has sent nothing for a second (missed out event)', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    penHover()
    now.mockReturnValue(1900)
    await fireEvent.pointerDown(svg, touch())
    expect(tool.events).toEqual([])
    now.mockReturnValue(2100)
    await fireEvent.pointerDown(svg, touch({ pointerId: 4 }))
    expect(tool.kinds()).toEqual(['down'])
  })

  it('cancels a touch gesture in progress when a pen comes in range (the palm landed first)', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    await fireEvent.pointerDown(svg, touch())
    await fireEvent.pointerMove(svg, touch({ clientX: 60 }))
    penHover('pointerover')
    expect(tool.kinds()).toEqual(['down', 'move', 'cancel'])
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(3)
    // The pen can draw right away.
    await fireEvent.pointerDown(svg, { pointerType: 'pen', button: 0, buttons: 1, pointerId: 9, clientX: 20, clientY: 20 })
    expect(tool.kinds()).toEqual(['down', 'move', 'cancel', 'down'])
  })

  it('a pen coming in range does not cancel a mouse gesture', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    await fireEvent.pointerDown(svg, mouse())
    penHover('pointerover')
    await fireEvent.pointerUp(svg, mouse({ buttons: 0 }))
    expect(tool.kinds()).toEqual(['down', 'up'])
  })

  it('keeps palm rejection active while a pen is pressed down even past the hover timeout', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, drawWithFinger: true })
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    penHover('pointerdown', { button: 0, buttons: 1 })
    // Past the 1s hover timeout while still pressed: palm is still rejected.
    now.mockReturnValue(3000)
    await fireEvent.pointerDown(svg, touch())
    expect(tool.events).toEqual([])
    // Once lifted, palm rejection stays for the timeout window and then releases.
    penHover('pointerup', { button: 0, buttons: 0 })
    now.mockReturnValue(4500)
    await fireEvent.pointerDown(svg, touch({ pointerId: 5 }))
    expect(tool.kinds()).toEqual(['down'])
  })
})
