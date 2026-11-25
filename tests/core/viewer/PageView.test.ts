import { render } from '@testing-library/svelte'
import { AnnotationMode } from 'pdfjs-dist'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageView from '../../../src/core/viewer/PageView.svelte'
import { renderCache } from '../../../src/core/viewer/renderCache'
import { fakeRenderDoc } from './fakeDoc'

let n = 0
let setSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setSpy = vi.spyOn(renderCache, 'set')
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(doc: ReturnType<typeof fakeRenderDoc>['doc'], scale = 1, cacheId = `pv${++n}`) {
  return render(PageView, {
    props: {
      doc,
      cacheId,
      pageNumber: 1,
      pageSize: { width: 600, height: 800 },
      scale,
      left: 0,
      top: 16,
    },
  })
}

/** The canvas a page shows (by identity: canvases of equal size compare equal). */
const shownCanvas = (container: HTMLElement): Element | null => {
  const all = container.querySelectorAll('.page > canvas')
  expect(all.length).toBeLessThanOrEqual(1)
  return all[0] ?? null
}

describe('PageView render lifecycle', () => {
  it('renders with annotation storage so managed annotations can be suppressed', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    expect(renders[0].annotationMode).toBe(AnnotationMode.ENABLE_STORAGE)
  })

  it('shows and caches the canvas it rendered into, without copying it', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container } = mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    const canvas = renders[0].canvas!
    expect([canvas.width, canvas.height]).toEqual([600, 800])
    expect(shownCanvas(container)).toBeNull()
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    expect(setSpy.mock.calls[0][1]).toBe(canvas)
    expect(shownCanvas(container)).toBe(canvas)
    // Under the text layer and the overlay.
    expect(container.querySelector('.page')!.firstElementChild).toBe(canvas)
  })

  it('reuses a cached canvas on remount and keeps it when unmounted', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const first = mount(doc, 1, 'pv-reuse')
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const canvas = renders[0].canvas!
    first.unmount()
    expect(canvas.width).toBe(600)
    const second = mount(doc, 1, 'pv-reuse')
    expect(shownCanvas(second.container)).toBe(canvas)
    expect(renders).toHaveLength(1)
    second.unmount()
    renderCache.evictPrefix('pv-reuse:')
    expect(canvas.width).toBe(0)
  })

  it('swaps in the new canvas on a scale change and frees the old one', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container, rerender } = mount(doc, 1)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const old = renders[0].canvas!
    await rerender({ scale: 2 })
    await vi.waitFor(() => expect(renders).toHaveLength(2))
    // The old canvas stays (CSS-scaled) until the new one is ready.
    expect(shownCanvas(container)).toBe(old)
    renders[1].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledTimes(2))
    expect(shownCanvas(container)).toBe(renders[1].canvas)
    expect([old.width, old.height]).toEqual([0, 0])
  })

  it('frees a shown canvas the cache no longer holds on unmount', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { unmount } = mount(doc, 1, 'pv-evicted')
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const canvas = renders[0].canvas!
    // On screen: eviction leaves it to the page.
    renderCache.evictPrefix('pv-evicted:')
    expect(canvas.width).toBe(600)
    unmount()
    expect(canvas.width).toBe(0)
  })

  it('cancels the in-flight render on unmount, frees its canvas and caches nothing', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { unmount } = mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    unmount()
    expect(renders[0].cancel).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(renders[0].canvas!.width).toBe(0))
    expect(setSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('cancels the previous render when the scale changes', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { rerender } = mount(doc, 1)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    await rerender({ scale: 2 })
    expect(renders[0].cancel).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(renders).toHaveLength(2))
    expect(renders[1].scale).toBe(2)
  })

  it('does not log failures of a destroyed doc', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    await doc.destroy()
    renders[0].fail(new Error('Worker was destroyed'))
    await new Promise((r) => setTimeout(r, 0))
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs genuine render failures and frees the canvas', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].fail(new Error('broken page'))
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce())
    expect(renders[0].canvas!.width).toBe(0)
  })

  it('renders again when the shown canvas comes back blank from a GPU reset', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container } = mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const blank = renders[0].canvas!
    blank.dispatchEvent(new Event('contextrestored'))
    expect(renderCache.holds(blank)).toBe(false)
    await vi.waitFor(() => expect(renders).toHaveLength(2))
    renders[1].finish()
    await vi.waitFor(() => expect(shownCanvas(container)).toBe(renders[1].canvas))
    expect(blank.width).toBe(0)
  })

  it('keeps a canvas that lost its GPU context restorable and renders it once on restore', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container } = mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const canvas = renders[0].canvas!
    const lost = new Event('contextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    // Without preventDefault the browser never restores the 2D context.
    expect(lost.defaultPrevented).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(renders).toHaveLength(1)
    canvas.dispatchEvent(new Event('contextrestored'))
    await vi.waitFor(() => expect(renders).toHaveLength(2))
    renders[1].finish()
    await vi.waitFor(() => expect(shownCanvas(container)).toBe(renders[1].canvas))
    await new Promise((r) => setTimeout(r, 0))
    expect(renders).toHaveLength(2)
  })

  it('trims the render cache once its canvas left the screen', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { unmount } = mount(doc, 1, 'pv-trim')
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    const canvas = renders[0].canvas!
    // Trimming only helps once the canvas is off screen (no longer pinned).
    const connectedAtTrim: boolean[] = []
    vi.spyOn(renderCache, 'trim').mockImplementation(() => void connectedAtTrim.push(canvas.isConnected))
    unmount()
    await vi.waitFor(() => expect(connectedAtTrim).toEqual([false]))
    renderCache.evictPrefix('pv-trim:')
  })

  it('cleans up the pdf.js page on unmount', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { unmount } = mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    const page = await doc.getPage(1)
    expect(page.cleanup).not.toHaveBeenCalled()
    unmount()
    await vi.waitFor(() => expect(page.cleanup).toHaveBeenCalledOnce())
  })

  it('re-renders at the new device pixel ratio when it changes', async () => {
    const listeners: (() => void)[] = []
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: (_: string, l: () => void) => listeners.push(l),
        removeEventListener: (_: string, l: () => void) => listeners.splice(listeners.indexOf(l), 1),
      })),
    )
    const { doc, renders } = fakeRenderDoc(1)
    mount(doc)
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    expect(renders[0].scale).toBe(1)
    vi.stubGlobal('devicePixelRatio', 2)
    listeners.forEach((l) => l())
    await vi.waitFor(() => expect(renders).toHaveLength(2))
    expect(renders[1].scale).toBe(2)
    expect(window.matchMedia).toHaveBeenLastCalledWith('(resolution: 2dppx)')
  })
})

describe('PageView page entries', () => {
  function mountEntry(doc: ReturnType<typeof fakeRenderDoc>['doc'], props: Record<string, unknown>) {
    return render(PageView, {
      props: { doc, cacheId: `pv${++n}`, pageNumber: 1, pageSize: { width: 600, height: 800 }, scale: 1, left: 0, top: 16, ...props },
    })
  }

  it('an empty page shows no canvas and never asks pdf.js for a page', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container } = mountEntry(doc, { entry: { kind: 'blank', width: 600, height: 800, rotate: 0 } })
    await new Promise((r) => setTimeout(r, 0))
    expect(doc.getPage).not.toHaveBeenCalled()
    expect(renders).toHaveLength(0)
    expect(container.querySelector('.page > canvas')).toBeNull()
  })

  it('renders the entry’s file page with the page /Rotate plus the extra rotation', async () => {
    const { doc, renders } = fakeRenderDoc(3)
    const page = await doc.getPage(3)
    Object.assign(page, { rotate: 90 })
    const getViewport = vi.spyOn(page, 'getViewport')
    mountEntry(doc, { pageNumber: 1, entry: { kind: 'source', source: 2, rotate: 90 } })
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    expect(renders[0].page).toBe(3)
    expect(getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 180 })
  })

  it('a later copy of a file page is drawn without the file’s annotations, under its own cache key', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    mountEntry(doc, { entry: { kind: 'source', source: 0, rotate: 0 }, annotations: false })
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    expect(renders[0].annotationMode).toBe(AnnotationMode.DISABLE)
    renders[0].finish()
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledOnce())
    expect(setSpy.mock.calls[0][0]).toMatch(/#s0r0n$/)
  })

  it('removes the canvas when its position switches to an empty page', async () => {
    const { doc, renders } = fakeRenderDoc(1)
    const { container, rerender } = mountEntry(doc, {})
    await vi.waitFor(() => expect(renders).toHaveLength(1))
    renders[0].finish()
    await vi.waitFor(() => expect(container.querySelector('.page > canvas')).not.toBeNull())
    await rerender({ entry: { kind: 'blank', width: 600, height: 800, rotate: 0 } })
    expect(container.querySelector('.page > canvas')).toBeNull()
  })
})

describe('PageView text cursor (marker SmartMark)', () => {
  const layerOf = (container: HTMLElement) => container.querySelector('.text-layer')!

  it('shows the text cursor on the whole text layer only when asked', () => {
    const { doc } = fakeRenderDoc(1)
    const props = { doc, cacheId: `pv${++n}`, pageNumber: 1, pageSize: { width: 600, height: 800 }, scale: 1, left: 0, top: 16 }
    const off = render(PageView, { props })
    expect(layerOf(off.container).classList.contains('text-cursor')).toBe(false)
    off.unmount()
    const on = render(PageView, { props: { ...props, textCursor: true } })
    expect(layerOf(on.container).classList.contains('text-cursor')).toBe(true)
  })
})
