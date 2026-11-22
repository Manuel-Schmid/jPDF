import { fireEvent, render } from '@testing-library/svelte'
import { flushSync } from 'svelte'
import type { PageViewport } from 'pdfjs-dist'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import { CommandRegistry } from '../../../src/core/registry/commands'
import { KeybindingRegistry } from '../../../src/core/registry/keybindings'
import type { ToolHandler } from '../../../src/core/registry/tools'
import type { HighlightAnnotation, InkAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import {
  AnnotationView,
  annotationView,
  registerAnnotationViewCommands,
} from '../../../src/core/viewer/annotationView.svelte'
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

const hl = (id = 'h1'): HighlightAnnotation => ({
  id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
  quads: [[10, 90, 50, 90, 10, 80, 50, 80]],
  color: [1, 1, 0], opacity: 0.4,
})

const ink = (): InkAnnotation => ({
  id: 'i1', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
  strokes: [[[10, 10], [20, 20]]], color: [0, 0, 0], opacity: 1, width: 2, blend: 'normal', role: 'pen',
})

function spyTool(): ToolHandler & { downs: number } {
  const t = { downs: 0, onPointerDown: () => void t.downs++ }
  return t as ToolHandler & { downs: number }
}

function mount(props: Record<string, unknown> = {}, store = new AnnotationStore()) {
  const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, ...props } })
  const svg = r.container.querySelector('svg')!
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect
  svg.setPointerCapture = vi.fn()
  return { ...r, svg, page: svg.parentElement! }
}

const left = { button: 0, buttons: 1, pointerId: 1, clientX: 40, clientY: 30 }

beforeEach(() => {
  annotationView.hidden = false
  annotationView.memory = false
  annotationView.coverAll()
})

describe('AnnotationView', () => {
  it('memory mode covers highlights until revealed, and every toggle covers them again', () => {
    const v = new AnnotationView()
    expect(v.covers('a')).toBe(false)
    v.toggleMemory()
    expect(v.covers('a')).toBe(true)
    v.reveal('a')
    expect(v.covers('a')).toBe(false)
    expect(v.covers('b')).toBe(true)
    v.coverAll()
    expect(v.covers('a')).toBe(true)
    v.reveal('a')
    v.toggleMemory()
    v.toggleMemory()
    expect(v.covers('a')).toBe(true)
  })

  it('show() only ever shows', () => {
    const v = new AnnotationView()
    v.show()
    expect(v.hidden).toBe(false)
    v.toggleHidden()
    v.show()
    expect(v.hidden).toBe(false)
  })
})

describe('annotation view commands', () => {
  function setup(hasDoc = true) {
    const cmds = new CommandRegistry()
    const kb = new KeybindingRegistry(cmds)
    const view = new AnnotationView()
    const dispose = registerAnnotationViewCommands(() => hasDoc, view, cmds, kb)
    const press = (init: KeyboardEventInit) => kb.handle(new KeyboardEvent('keydown', init))
    return { cmds, view, press, dispose }
  }

  it('H toggles hidden, Q memory mode, Shift+Q covers again only in memory mode', () => {
    const { view, press } = setup()
    expect(press({ key: 'h' })).toBe(true)
    expect(view.hidden).toBe(true)
    press({ key: 'h' })
    expect(view.hidden).toBe(false)
    expect(press({ key: 'Q', shiftKey: true })).toBe(false)
    press({ key: 'q' })
    expect(view.memory).toBe(true)
    view.reveal('a')
    expect(press({ key: 'Q', shiftKey: true })).toBe(true)
    expect(view.covers('a')).toBe(true)
  })

  it('does nothing without a document, and unregisters', () => {
    const { cmds, press, dispose } = setup(false)
    expect(press({ key: 'h' })).toBe(false)
    expect(cmds.has('view.hideAnnotations')).toBe(true)
    dispose()
    expect(cmds.has('view.hideAnnotations')).toBe(false)
    expect(cmds.has('view.memoryMode')).toBe(false)
  })
})

describe('Overlay: hidden annotations', () => {
  it('hides everything it draws with one class, without removing the annotations', () => {
    const store = new AnnotationStore()
    store.add(ink())
    const { svg } = mount({}, store)
    expect(svg.classList.contains('annotations-hidden')).toBe(false)
    annotationView.hidden = true
    flushSync()
    expect(svg.classList.contains('annotations-hidden')).toBe(true)
    expect(svg.querySelector('path, polyline, g')).not.toBeNull()
  })

  it("a tool's press shows them again and still reaches the tool", async () => {
    const tool = spyTool()
    const { svg } = mount({ tool })
    annotationView.hidden = true
    flushSync()
    await fireEvent.pointerDown(svg, left)
    expect(annotationView.hidden).toBe(false)
    expect(tool.downs).toBe(1)
  })

  it('a press without a tool leaves them hidden', async () => {
    const { svg } = mount({ tool: null })
    annotationView.hidden = true
    await fireEvent.pointerDown(svg, left)
    expect(annotationView.hidden).toBe(true)
  })

  it('a right-button erase shows them again', async () => {
    const { page } = mount({ tool: null, eraser: spyTool() })
    annotationView.hidden = true
    page.dispatchEvent(new PointerEvent('pointerdown', { ...left, button: 2, buttons: 2, bubbles: true, cancelable: true }))
    expect(annotationView.hidden).toBe(false)
  })
})

describe('memory mode', () => {
  it('draws highlights opaque and normal-blended while covered', () => {
    const store = new AnnotationStore()
    store.add(hl())
    const { container } = mount({}, store)
    const g = () => container.querySelector('g')!
    expect(g().getAttribute('opacity')).toBe('0.4')
    expect(g().hasAttribute('data-reveal')).toBe(false)
    annotationView.toggleMemory()
    flushSync()
    expect(g().hasAttribute('opacity')).toBe(false)
    expect(g().style.mixBlendMode).toBe('')
    expect(g().getAttribute('data-reveal')).toBe('h1')
  })

  it('a press on a covered highlight reveals it and reaches neither the tool nor the page', async () => {
    const store = new AnnotationStore()
    store.add(hl('h1'))
    store.add(hl('h2'))
    const tool = spyTool()
    const { container, page } = mount({ tool }, store)
    annotationView.toggleMemory()
    flushSync()
    const onPage = vi.fn()
    page.addEventListener('pointerdown', onPage)
    const polygon = container.querySelector('[data-reveal="h1"] polygon')!
    const down = new PointerEvent('pointerdown', { ...left, bubbles: true, cancelable: true })
    polygon.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(annotationView.covers('h1')).toBe(false)
    expect(annotationView.covers('h2')).toBe(true)
    expect(tool.downs).toBe(0)
    expect(onPage).not.toHaveBeenCalled()
    flushSync()
    expect(container.querySelector('[data-reveal="h1"]')).toBeNull()
    // Revealed: the next press is the tool's again.
    await fireEvent.pointerDown(container.querySelector('svg')!, left)
    expect(tool.downs).toBe(1)
  })
})
