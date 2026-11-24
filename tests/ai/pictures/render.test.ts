import { AnnotationMode } from 'pdfjs-dist'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPicture } from '../../../src/ai/pictures/render'
import type { PdfDoc } from '../../../src/core/viewer/pdfEngine'

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x41, 0x42])

/** Stand-in for OffscreenCanvas (jsdom has none). */
class FakeOffscreen {
  static last: FakeOffscreen | null = null
  /** The size it was created at (renderPicture zeroes it afterwards to free the pixels). */
  readonly created: { width: number; height: number }
  convertToBlob = vi.fn(async (_opts: unknown) => new Blob([BYTES], { type: 'image/jpeg' }))
  constructor(
    public width: number,
    public height: number,
  ) {
    this.created = { width, height }
    FakeOffscreen.last = this
  }
}

function fakeDoc(size = { width: 600, height: 800 }, rotate = 0) {
  const page = {
    rotate,
    cleanup: vi.fn(() => true),
    getViewport: vi.fn(({ scale, rotation }: { scale: number; rotation: number }) => {
      const quarter = rotation % 180 !== 0
      return {
        width: (quarter ? size.height : size.width) * scale,
        height: (quarter ? size.width : size.height) * scale,
      }
    }),
    render: vi.fn((_params: unknown) => ({ promise: Promise.resolve() })),
  }
  const raw = { destroyed: false, getPage: vi.fn(async (_i: number) => page) }
  return { doc: raw as unknown as PdfDoc, page, raw }
}

const entry = (source = 0, rotate = 0) => ({ kind: 'source' as const, source, rotate })

beforeEach(() => {
  FakeOffscreen.last = null
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen)
})
afterEach(() => vi.unstubAllGlobals())

describe('renderPicture', () => {
  it('renders without annotations', async () => {
    const { doc, page, raw } = fakeDoc()
    await renderPicture(doc, entry(2), 7)
    expect(raw.getPage).toHaveBeenCalledWith(3)
    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({ annotationMode: AnnotationMode.DISABLE }))
  })

  it('applies the page rotation', async () => {
    const { doc, page } = fakeDoc(undefined, 90)
    await renderPicture(doc, entry(0, 90), 1)
    expect(page.getViewport).toHaveBeenCalled()
    for (const [arg] of page.getViewport.mock.calls) expect(arg.rotation).toBe(180)
  })

  it('wraps rotation past a full turn', async () => {
    const { doc, page } = fakeDoc(undefined, 270)
    await renderPicture(doc, entry(0, 180), 1)
    for (const [arg] of page.getViewport.mock.calls) expect(arg.rotation).toBe(90)
  })

  it('long edge is 1280', async () => {
    const { doc, page } = fakeDoc({ width: 600, height: 800 }, 90)
    await renderPicture(doc, entry(), 1)
    const used = (page.render.mock.calls[0][0] as { viewport: { width: number; height: number } }).viewport
    expect(Math.max(used.width, used.height)).toBeCloseTo(1280)
    // Turned a quarter: the long edge is the width.
    expect(FakeOffscreen.last!.created).toEqual({ width: 1280, height: 960 })
    // The pixels are freed afterwards.
    expect(FakeOffscreen.last!.width).toBe(0)
  })

  it('encodes jpeg 0.8', async () => {
    const { doc } = fakeDoc()
    const pic = await renderPicture(doc, entry(), 4)
    expect(FakeOffscreen.last!.convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.8 })
    expect(pic).toEqual({ page: 4, mediaType: 'image/jpeg', data: btoa(String.fromCharCode(...BYTES)) })
  })

  it('cleans up the page', async () => {
    const { doc, page } = fakeDoc()
    await renderPicture(doc, entry(), 1)
    expect(page.cleanup).toHaveBeenCalled()
  })

  it('skips cleanup on a destroyed doc', async () => {
    const { doc, page, raw } = fakeDoc()
    page.render.mockImplementation(() => {
      raw.destroyed = true
      return { promise: Promise.resolve() }
    })
    await renderPicture(doc, entry(), 1)
    expect(page.cleanup).not.toHaveBeenCalled()
  })

  it('cleans up when the viewport throws', async () => {
    const { doc, page } = fakeDoc()
    page.getViewport.mockImplementation(() => {
      throw new Error('bad page')
    })
    await expect(renderPicture(doc, entry(), 1)).rejects.toThrow('bad page')
    expect(page.cleanup).toHaveBeenCalled()
  })

  it('rejects a blank entry', async () => {
    const { doc } = fakeDoc()
    await expect(renderPicture(doc, { kind: 'blank' } as never, 1)).rejects.toThrow()
  })
})
