import { fireEvent, render, within } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import type { PagePointerEvent, ToolHandler } from '../../../src/core/registry/tools'
import type { Annotation, FreeTextAnnotation, InkAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay from '../../../src/core/viewer/Overlay.svelte'

// Page 100pt tall at scale 2.
const vp = {
  scale: 2,
  rotation: 0,
  width: 200,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

const box: FreeTextAnnotation = {
  id: 'a', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
  rect: [10, 70, 60, 90], text: 'hi', lines: ['hi'], fontSize: 10, textColor: [0, 0, 0], background: null, align: 'left',
}
const ink: InkAnnotation = {
  id: 'i', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
  strokes: [[[20, 20], [40, 40]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
}

function mount(props: Record<string, unknown>, list: Annotation[] = [box, ink]) {
  const store = new AnnotationStore()
  store.load(list)
  const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, ...props } })
  const svg = r.container.querySelector('svg')!
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect
  return { ...r, svg, store }
}

const attrs = (el: Element | null) => el && ['x', 'y', 'width', 'height'].map((k) => Number(el.getAttribute(k)))

describe('Overlay selection', () => {
  it('outlines the selected text box with e/w handles only', () => {
    const { container } = mount({ selection: ['a'] })
    // rect [10, 70, 60, 90] → screen [20, 20, 120, 60]
    expect(attrs(container.querySelector('.selection-box'))).toEqual([20, 20, 100, 40])
    const handles = [...container.querySelectorAll('.handle')]
    expect(handles.map((h) => h.getAttribute('data-handle'))).toEqual(['rotate', 'e', 'w'])
    // The east edge's handle: an upright pill (6 x 21, round ends) centred on (120, 40).
    expect(attrs(handles[1])).toEqual([117, 29.5, 6, 21])
    expect(handles[1].getAttribute('rx')).toBe('3')
    // The rotate handle: a circle on a stem above the middle of the top edge.
    expect(['cx', 'cy', 'r'].map((k) => Number(handles[0].getAttribute(k)))).toEqual([70, -2, 5])
    expect(container.querySelector('.rotate-stem')).not.toBeNull()
  })

  it('gives ink all eight handles and the rotate handle, and highlights none', () => {
    const { container } = mount({ selection: ['i'] })
    expect(container.querySelectorAll('.handle')).toHaveLength(9)
    const hl: Annotation = {
      id: 'h', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
      quads: [[0, 10, 10, 10, 0, 0, 10, 0]], color: [1, 1, 0], opacity: 0.4,
    }
    const other = mount({ selection: ['h'] }, [hl])
    expect(other.container.querySelector('.selection-box')).not.toBeNull()
    expect(other.container.querySelectorAll('.handle')).toHaveLength(0)
  })

  it('draws a turned box and its handles turned around its centre', () => {
    const { container } = mount({ selection: ['a'] }, [{ ...box, rotation: 90 }])
    const g = container.querySelector('.selection')!
    // Screen box [20, 20, 120, 60], centre (70, 40); SVG turns clockwise for positive angles.
    expect(g.getAttribute('transform')).toBe('rotate(-90 70 40)')
    expect(attrs(container.querySelector('.selection-box'))).toEqual([20, 20, 100, 40])
  })

  it('draws corners as circles and edges as pills lying along their edge', () => {
    const { container } = mount({ selection: ['i'] })
    // Ink bounds [19, 19, 41, 41] → screen [38, 118, 82, 162].
    const nw = container.querySelector('[data-handle="nw"]')!
    expect(nw.tagName.toLowerCase()).toBe('circle')
    expect(['cx', 'cy', 'r'].map((k) => Number(nw.getAttribute(k)))).toEqual([38, 118, 4.5])
    const n = container.querySelector('[data-handle="n"]')!
    expect(n.tagName.toLowerCase()).toBe('rect')
    expect(attrs(n)).toEqual([49.5, 115, 21, 6])
  })

  it('enlarges the handle under the pointer, and lets go when the pointer leaves', async () => {
    const { container } = mount({ selection: ['a'] })
    const page = container
    const east = () => container.querySelector('[data-handle="e"]')!
    const west = () => container.querySelector('[data-handle="w"]')!
    await fireEvent.pointerMove(page, { clientX: 121, clientY: 44, buttons: 0 })
    expect(east().classList.contains('hover')).toBe(true)
    expect(west().classList.contains('hover')).toBe(false)
    await fireEvent.pointerMove(page, { clientX: 70, clientY: 40, buttons: 0 })
    expect(east().classList.contains('hover')).toBe(false)
    await fireEvent.pointerMove(page, { clientX: 20, clientY: 40, buttons: 0 })
    expect(west().classList.contains('hover')).toBe(true)
    await fireEvent.pointerLeave(page)
    expect(west().classList.contains('hover')).toBe(false)
  })

  it('follows the dragged preview, and draws nothing for a hidden selection or another page', () => {
    const moved = { ...box, rect: [20, 70, 70, 90] as FreeTextAnnotation['rect'] }
    const dragging = mount({ selection: ['a'], preview: moved, hidden: new Set(['a']) })
    expect(attrs(dragging.container.querySelector('.selection-box'))![0]).toBe(40)
    const editing = mount({ selection: ['a'], hidden: new Set(['a']) })
    expect(editing.container.querySelector('.selection-box')).toBeNull()
    const elsewhere = mount({ selection: ['a'], pageNumber: 2 })
    expect(elsewhere.container.querySelector('.selection-box')).toBeNull()
  })
})

describe('Overlay hover pass-through', () => {
  function passTool() {
    const onPassThroughDown = vi.fn()
    const onPointerDown = vi.fn()
    const tool: ToolHandler = {
      // Something of the tool's is left of x = 50pt.
      passThroughAt: (e: PagePointerEvent) => e.pdf[0] >= 50,
      onPassThroughDown,
      onPointerDown,
    }
    return { tool, onPassThroughDown, onPointerDown }
  }

  it('lets input through to the page except where the tool has something', async () => {
    const { tool, onPassThroughDown, onPointerDown } = passTool()
    const { svg, container } = mount({ tool })
    expect(svg.classList.contains('interactive')).toBe(false)

    await fireEvent.pointerMove(container, { clientX: 20, clientY: 20, buttons: 0 })
    expect(svg.classList.contains('interactive')).toBe(true)
    await fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(onPassThroughDown).not.toHaveBeenCalled()
    await fireEvent.pointerUp(svg, { clientX: 20, clientY: 20, pointerId: 1 })

    await fireEvent.pointerMove(container, { clientX: 150, clientY: 20, buttons: 0 })
    expect(svg.classList.contains('interactive')).toBe(false)
    // A press on the text layer (here: the page itself) is reported to the tool.
    await fireEvent.pointerDown(container, { button: 0, clientX: 150, clientY: 20, pointerId: 2 })
    expect(onPassThroughDown).toHaveBeenCalledOnce()
    expect(onPassThroughDown.mock.calls[0][0].pdf).toEqual([75, 90])
  })

  it('does not switch while a button is held (a text selection drag)', async () => {
    const { tool } = passTool()
    const { svg, container } = mount({ tool })
    await fireEvent.pointerMove(container, { clientX: 20, clientY: 20, buttons: 1 })
    expect(svg.classList.contains('interactive')).toBe(false)
  })
})

describe('Overlay selection bar', () => {
  const image: Annotation = {
    id: 'img', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'image',
    rect: [10, 10, 30, 30], image: { width: 1, height: 1, png: '' },
  }

  it('shows the actions and a Style button next to a single selection', () => {
    const r = mount({ selection: ['a'], onstyle: vi.fn() })
    const bar = r.getByRole('toolbar', { name: 'Selection actions' })
    expect(within(bar).getByRole('button', { name: 'Style' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: /Delete/ })).toBeTruthy()
    // One element: no count.
    expect(within(bar).queryByText(/selected/)).toBeNull()
  })

  it('has no Style button for an image', () => {
    const r = mount({ selection: ['img'], onstyle: vi.fn() }, [image])
    expect(r.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy()
    expect(r.queryByRole('button', { name: 'Style' })).toBeNull()
  })

  it('has no Style button for a group of different kinds', () => {
    const r = mount({ selection: ['a', 'i'], onstyle: vi.fn(), tool: { groupSelection: true } })
    expect(r.getByText('2 selected')).toBeTruthy()
    expect(r.queryByRole('button', { name: 'Style' })).toBeNull()
  })

  it('opens the Style card with the controls of the selected kind; a change is committed through onstyle', async () => {
    const onstyle = vi.fn()
    const r = mount({ selection: ['a'], onstyle })
    await fireEvent.click(r.getByRole('button', { name: 'Style' }))
    const card = r.getByRole('dialog', { name: 'Style' })
    // Outside the page, which clips its content.
    expect(r.container.contains(card)).toBe(false)
    await fireEvent.click(within(card).getByRole('radio', { name: 'Right' }))
    expect(onstyle).toHaveBeenCalledWith([{ ...box, align: 'right' }])
  })

  it('draws the live style while a control is dragged, and the stored one after Escape', async () => {
    const r = mount({ selection: ['i'], onstyle: vi.fn() })
    await fireEvent.click(r.getByRole('button', { name: 'Style' }))
    const slider = within(r.getByRole('dialog', { name: 'Style' })).getByRole('slider', { name: 'Width' }) as HTMLInputElement
    slider.value = '10'
    await fireEvent.input(slider)
    const path = () => r.container.querySelector('svg [stroke-width]')
    expect(Number(path()!.getAttribute('stroke-width'))).toBe(20)
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(r.queryByRole('dialog', { name: 'Style' })).toBeNull()
    expect(Number(path()!.getAttribute('stroke-width'))).toBe(4)
  })

  it('hides the bar while a text box is edited and while the selection is dragged', () => {
    const edit = { draft: box, rotation: 0, setText: vi.fn(), commit: vi.fn() }
    const editing = mount({ selection: ['a'], onstyle: vi.fn(), textEdit: edit })
    expect(editing.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
    const dragging = mount({ selection: ['a'], onstyle: vi.fn(), preview: { ...box, rect: [20, 70, 70, 90] } })
    expect(dragging.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
  })
})

describe('Overlay selection bar over page text', () => {
  // The select tool over text: presses go through to the text layer (deselect).
  function passingTool() {
    return { passThroughAt: () => true, onPassThroughDown: vi.fn(), onContextMenu: vi.fn(() => false) }
  }

  it('a press on the bar is not a press on the text under it', async () => {
    const tool = passingTool()
    const r = mount({ selection: ['a'], onstyle: vi.fn(), tool })
    const del = r.getByRole('button', { name: /Delete/ })
    await fireEvent.pointerMove(del, { clientX: 30, clientY: 10, buttons: 0 })
    await fireEvent.pointerDown(del, { clientX: 30, clientY: 10, button: 0 })
    expect(tool.onPassThroughDown).not.toHaveBeenCalled()
    await fireEvent.pointerDown(r.getByRole('button', { name: 'Style' }), { clientX: 10, clientY: 10, button: 0 })
    expect(tool.onPassThroughDown).not.toHaveBeenCalled()
  })

  it('presses in the Style card do not reach the page either', async () => {
    const tool = passingTool()
    const onstyle = vi.fn()
    const r = mount({ selection: ['a'], onstyle, tool })
    await fireEvent.click(r.getByRole('button', { name: 'Style' }))
    const right = within(r.getByRole('dialog', { name: 'Style' })).getByRole('radio', { name: 'Right' })
    await fireEvent.pointerDown(right, { button: 0 })
    await fireEvent.click(right)
    expect(tool.onPassThroughDown).not.toHaveBeenCalled()
    expect(onstyle).toHaveBeenCalledOnce()
  })

  it('a right-click on the bar neither erases nor opens the page menu', async () => {
    const tool = passingTool()
    const eraser = { onPointerDown: vi.fn() }
    const onpagemenu = vi.fn()
    const r = mount({ selection: ['a'], onstyle: vi.fn(), tool, eraser, onpagemenu })
    const bar = r.getByRole('toolbar', { name: 'Selection actions' })
    await fireEvent.pointerDown(bar, { clientX: 10, clientY: 10, button: 2 })
    expect(eraser.onPointerDown).not.toHaveBeenCalled()
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    bar.dispatchEvent(menu)
    expect(onpagemenu).not.toHaveBeenCalled()
    // No browser menu either.
    expect(menu.defaultPrevented).toBe(true)
  })
})
