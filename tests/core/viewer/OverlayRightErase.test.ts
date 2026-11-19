import { fireEvent, render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import type { PagePointerEvent, ToolContext, ToolHandler } from '../../../src/core/registry/tools'
import type { Command } from '../../../src/core/session/history.svelte'
import type { Annotation, InkAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay from '../../../src/core/viewer/Overlay.svelte'
import { createEraserHandler } from '../../../src/tools/eraser'

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

function mount(props: Record<string, unknown>, store = new AnnotationStore()) {
  const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, cursor: 'copy', ...props } })
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

const right = (over: Record<string, unknown> = {}) => ({ button: 2, buttons: 2, pointerId: 1, clientX: 20, clientY: 20, ...over })

describe('Overlay: hold right button = temporary eraser', () => {
  it('routes a right-button drag to the eraser, not the tool, even without a tool', async () => {
    const eraser = spy()
    const { svg, page } = mount({ tool: null, eraser: eraser.handler })
    expect(svg.classList.contains('interactive')).toBe(false)
    const down = new PointerEvent('pointerdown', { ...right(), bubbles: true, cancelable: true })
    page.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(svg.setPointerCapture).toHaveBeenCalledWith(1)
    await fireEvent.pointerMove(svg, right({ clientX: 40 }))
    await fireEvent.pointerUp(svg, right({ buttons: 0, clientX: 40 }))
    expect(eraser.kinds()).toEqual(['down', 'move', 'up'])
    expect(eraser.events[0][1].pdf).toEqual([10, 90])
  })

  it('uses the eraser cursor and takes input while erasing, then restores', async () => {
    const tool = spy()
    const eraser = spy()
    const { svg } = mount({ tool: tool.handler, eraser: eraser.handler })
    expect(svg.style.cursor).toBe('copy')
    await fireEvent.pointerDown(svg, right())
    expect(svg.style.cursor).toBe('crosshair')
    expect(svg.classList.contains('interactive')).toBe(true)
    await fireEvent.pointerUp(svg, right({ buttons: 0 }))
    expect(svg.style.cursor).toBe('copy')
    expect(tool.events).toEqual([])
  })

  it('works while the overlay passes input through (marker text mode) without reaching the page', async () => {
    const eraser = spy()
    const tool = { ...spy().handler, textSelection: () => ({ color: [1, 1, 0] as [number, number, number] }) }
    const { svg, page, text } = mount({ tool, eraser: eraser.handler })
    expect(svg.classList.contains('interactive')).toBe(false)
    const bubbled = vi.fn()
    page.addEventListener('pointerdown', bubbled)
    await fireEvent.pointerDown(text, right())
    expect(bubbled).not.toHaveBeenCalled()
    expect(svg.classList.contains('interactive')).toBe(true)
    await fireEvent.pointerUp(svg, right({ buttons: 0 }))
    expect(eraser.kinds()).toEqual(['down', 'up'])
  })

  it('cancel and lost capture discard the gesture', async () => {
    const eraser = spy()
    const { svg } = mount({ tool: null, eraser: eraser.handler })
    await fireEvent.pointerDown(svg, right())
    await fireEvent.pointerCancel(svg, right())
    await fireEvent.pointerDown(svg, right({ pointerId: 2 }))
    await fireEvent(svg, new PointerEvent('lostpointercapture', { pointerId: 2 }))
    expect(eraser.kinds()).toEqual(['down', 'cancel', 'down', 'cancel'])
  })

  it('a left gesture is not interrupted by right presses, and left presses do not end a right gesture', async () => {
    const tool = spy()
    const eraser = spy()
    const { svg } = mount({ tool: tool.handler, eraser: eraser.handler })
    // Chromium reports a chorded button as pointermove, not pointerdown.
    await fireEvent.pointerDown(svg, { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 20 })
    await fireEvent.pointerMove(svg, { button: 2, buttons: 3, pointerId: 1, clientX: 30, clientY: 20 })
    await fireEvent.pointerMove(svg, { button: 2, buttons: 1, pointerId: 1, clientX: 40, clientY: 20 })
    await fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 1, clientX: 40, clientY: 20 })
    expect(tool.kinds()).toEqual(['down', 'move', 'move', 'up'])
    expect(eraser.events).toEqual([])

    await fireEvent.pointerDown(svg, right({ pointerId: 2 }))
    await fireEvent.pointerMove(svg, { button: 0, buttons: 3, pointerId: 2, clientX: 30, clientY: 20 })
    await fireEvent.pointerMove(svg, { button: 0, buttons: 2, pointerId: 2, clientX: 40, clientY: 20 })
    expect(eraser.kinds()).toEqual(['down', 'move', 'move'])
    // Right released while left is still held: the erase ends there.
    await fireEvent.pointerMove(svg, { button: 2, buttons: 1, pointerId: 2, clientX: 50, clientY: 20 })
    await fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 2, clientX: 50, clientY: 20 })
    expect(eraser.kinds()).toEqual(['down', 'move', 'move', 'up'])
    expect(tool.kinds()).toEqual(['down', 'move', 'move', 'up'])
  })

  it('suppresses the context menu over the page but not in a text box editor', async () => {
    const eraser = spy()
    const { page } = mount({ tool: null, eraser: eraser.handler })
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    page.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)

    const textarea = document.createElement('textarea')
    page.append(textarea)
    const down = new PointerEvent('pointerdown', { ...right(), bubbles: true, cancelable: true })
    textarea.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(eraser.events).toEqual([])
    const editorMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    textarea.dispatchEvent(editorMenu)
    expect(editorMenu.defaultPrevented).toBe(false)
  })

  it('without an eraser, a right-click opens the page menu at the cursor for this page', async () => {
    const onpagemenu = vi.fn()
    const { page } = mount({ tool: null, eraser: null, pageNumber: 4, onpagemenu })
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 33, clientY: 44 })
    page.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(onpagemenu).toHaveBeenCalledWith(3, 33, 44, { pdf: expect.any(Array), vp, onSelection: false })

    // Not in the text box editor: the native menu stays there.
    const textarea = document.createElement('textarea')
    page.append(textarea)
    const editorMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    textarea.dispatchEvent(editorMenu)
    expect(editorMenu.defaultPrevented).toBe(false)
    expect(onpagemenu).toHaveBeenCalledOnce()
  })

  it('lets the tool select what was right-clicked before the menu opens', async () => {
    const order: string[] = []
    const onContextMenu = vi.fn((e: PagePointerEvent) => {
      order.push(`tool at ${e.pdf.map(Math.round).join(',')} on page ${e.page}`)
      return true
    })
    const onpagemenu = vi.fn((...args: unknown[]) => void order.push(`menu ${JSON.stringify((args[3] as { onSelection: boolean }).onSelection)}`))
    const { page } = mount({ tool: { onContextMenu }, eraser: null, onpagemenu })
    page.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 40 }))
    // Screen (20, 40) at scale 2 on a 100pt page: PDF (10, 80).
    expect(order).toEqual(['tool at 10,80 on page 0', 'menu true'])
  })

  it('with the eraser enabled, a right-click never opens the page menu', async () => {
    const onpagemenu = vi.fn()
    const { page } = mount({ tool: null, eraser: spy().handler, onpagemenu })
    page.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onpagemenu).not.toHaveBeenCalled()
  })

  it('without an eraser (hand tool) a right press does nothing', async () => {
    const tool = spy()
    const { svg } = mount({ tool: tool.handler, eraser: null })
    await fireEvent.pointerDown(svg, right())
    await fireEvent.pointerUp(svg, right({ buttons: 0 }))
    expect(tool.events).toEqual([])
    expect(svg.style.cursor).toBe('copy')
  })

  it('erases two strokes with the real eraser: hidden during the drag, one delete on release', async () => {
    const line = (id: string, y: number): InkAnnotation => ({
      id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
      strokes: [[[10, y], [90, y]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
    })
    const store = new AnnotationStore()
    store.load([line('a', 80), line('b', 60)])
    let hidden = new Set<string>()
    const executed: Command[] = []
    const ctx = {
      session: { store },
      execute: (c: Command) => executed.push(c),
      hidden: { get ids() { return hidden }, set: (ids: Iterable<string>) => { hidden = new Set(ids) } },
    } as unknown as ToolContext
    const { svg, rerender } = mount({ tool: null, eraser: createEraserHandler(ctx) }, store)
    // x = 50pt → 100px; y = 90pt → 20px, 50pt → 100px.
    await fireEvent.pointerDown(svg, right({ clientX: 100, clientY: 20 }))
    await fireEvent.pointerMove(svg, right({ clientX: 100, clientY: 100 }))
    expect([...hidden].sort()).toEqual(['a', 'b'])
    await rerender({ hidden })
    expect(svg.querySelectorAll('path')).toHaveLength(0)
    expect(executed).toHaveLength(0)
    await fireEvent.pointerUp(svg, right({ buttons: 0, clientX: 100, clientY: 100 }))
    expect(hidden.size).toBe(0)
    expect(executed).toHaveLength(1)
    executed[0].do(store)
    expect(store.byPage(0)).toEqual([] as Annotation[])
  })

  it('a right press on another page cancels a stale erase gesture of the shared eraser', async () => {
    const eraser = spy()
    const a = mount({ tool: null, eraser: eraser.handler, pageNumber: 1 })
    const b = mount({ tool: null, eraser: eraser.handler, pageNumber: 2 })
    await fireEvent.pointerDown(a.svg, right({ pointerId: 1 }))
    await fireEvent.pointerDown(b.svg, right({ pointerId: 2 }))
    expect(eraser.kinds()).toEqual(['down', 'cancel', 'down'])
    expect(eraser.events[1][1].page).toBe(0)
    expect(eraser.events[2][1].page).toBe(1)
    expect(a.svg.classList.contains('interactive')).toBe(false)
    // The stale page can no longer commit (or reset) the other page's erasures.
    await fireEvent.pointerMove(a.svg, right({ pointerId: 1 }))
    await fireEvent.pointerUp(a.svg, right({ pointerId: 1, buttons: 0 }))
    expect(eraser.kinds()).toEqual(['down', 'cancel', 'down'])
    await fireEvent.pointerUp(b.svg, right({ pointerId: 2, buttons: 0 }))
    expect(eraser.kinds()).toEqual(['down', 'cancel', 'down', 'up'])
  })

  it('swallows the context menu after an erase anywhere, once, for 500 ms', async () => {
    vi.useFakeTimers()
    try {
      const eraser = spy()
      const { svg } = mount({ tool: null, eraser: eraser.handler })
      const menu = () => {
        const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        document.body.dispatchEvent(e)
        return e.defaultPrevented
      }
      menu() // drains a guard left by an earlier test's erase (real timers there)
      expect(menu()).toBe(false)
      await fireEvent.pointerDown(svg, right())
      await fireEvent.pointerUp(svg, right({ buttons: 0 }))
      expect(menu()).toBe(true) // released outside the page
      expect(menu()).toBe(false) // only the one right after the release
      await fireEvent.pointerDown(svg, right())
      await fireEvent.pointerUp(svg, right({ buttons: 0 }))
      vi.advanceTimersByTime(501)
      expect(menu()).toBe(false) // expired
    } finally {
      vi.useRealTimers()
    }
  })

  function realEraser() {
    const line = (id: string, y: number): InkAnnotation => ({
      id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
      strokes: [[[10, y], [90, y]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
    })
    const store = new AnnotationStore()
    store.load([line('a', 80), line('b', 60)])
    const state = { hidden: new Set<string>() }
    const executed: Command[] = []
    const ctx = {
      session: { store },
      execute: (c: Command) => {
        executed.push(c)
        c.do(store)
      },
      hidden: { get ids() { return state.hidden }, set: (ids: Iterable<string>) => { state.hidden = new Set(ids) } },
    } as unknown as ToolContext
    return { store, state, executed, ctx }
  }

  it('right-drag works while the Eraser tool itself is active, independent of its left gestures', async () => {
    const { store, executed, ctx } = realEraser()
    const { svg } = mount({ tool: createEraserHandler(ctx), eraser: createEraserHandler(ctx) }, store)
    // Stroke a at y=80pt (40px), b at y=60pt (80px).
    await fireEvent.pointerDown(svg, right({ clientX: 100, clientY: 40 }))
    await fireEvent.pointerUp(svg, right({ buttons: 0, clientX: 100, clientY: 40 }))
    expect(executed).toHaveLength(1)
    expect(store.byPage(0).map((a) => a.id)).toEqual(['b'])
    await fireEvent.pointerDown(svg, { button: 0, buttons: 1, pointerId: 3, clientX: 100, clientY: 80 })
    await fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 3, clientX: 100, clientY: 80 })
    expect(executed).toHaveLength(2)
    expect(store.byPage(0)).toEqual([])
  })

  it('unmounting during a right gesture cancels it: nothing deleted, hidden cleared', async () => {
    const { store, state, executed, ctx } = realEraser()
    const { svg, unmount } = mount({ tool: null, eraser: createEraserHandler(ctx) }, store)
    await fireEvent.pointerDown(svg, right({ clientX: 100, clientY: 40 }))
    expect([...state.hidden]).toEqual(['a'])
    unmount()
    expect(state.hidden.size).toBe(0)
    expect(executed).toEqual([])
    expect(store.byPage(0)).toHaveLength(2)
  })
})
