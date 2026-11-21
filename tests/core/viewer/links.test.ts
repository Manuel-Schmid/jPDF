import { describe, expect, it, vi } from 'vitest'
import type { PDFPageProxy } from 'pdfjs-dist'
import {
  createLinkLookup, linkAt, linksFromAnnotations, linksOf, resolveDestination, type PageLink,
} from '../../../src/core/viewer/links'
import type { PageEntry } from '../../../src/core/session/pages'

const url = (u: string, rect = [10, 10, 50, 20]) => ({ subtype: 'Link', rect, url: u })

describe('linksFromAnnotations', () => {
  it('keeps web links, destinations and page-turning actions with normalized rects', () => {
    const links = linksFromAnnotations([
      url('https://example.com/', [50, 20, 10, 10]),
      { subtype: 'Link', rect: [0, 0, 5, 5], dest: 'chapter1' },
      { subtype: 'Link', rect: [0, 0, 5, 5], dest: [{ num: 3, gen: 0 }, { name: 'Fit' }] },
      { subtype: 'Link', rect: [0, 0, 5, 5], action: 'NextPage' },
    ])
    expect(links).toEqual([
      { rect: [10, 10, 50, 20], target: { kind: 'url', url: 'https://example.com/' } },
      { rect: [0, 0, 5, 5], target: { kind: 'dest', dest: 'chapter1' } },
      { rect: [0, 0, 5, 5], target: { kind: 'dest', dest: [{ num: 3, gen: 0 }, { name: 'Fit' }] } },
      { rect: [0, 0, 5, 5], target: { kind: 'named', action: 'NextPage' } },
    ])
  })

  it('skips other annotations, unsafe URLs, unknown actions and empty rects', () => {
    expect(
      linksFromAnnotations([
        { subtype: 'Highlight', rect: [0, 0, 5, 5], url: 'https://x.org' },
        { subtype: 'Link', rect: [0, 0, 5, 5], unsafeUrl: 'javascript:alert(1)' },
        { subtype: 'Link', rect: [0, 0, 5, 5], action: 'Print' },
        { subtype: 'Link', rect: [0, 0, 0, 5], url: 'https://x.org' },
        { subtype: 'Link', url: 'https://x.org' },
      ]),
    ).toEqual([])
  })
})

describe('linkAt', () => {
  const a: PageLink = { rect: [0, 0, 100, 100], target: { kind: 'url', url: 'https://a' } }
  const b: PageLink = { rect: [40, 40, 60, 60], target: { kind: 'url', url: 'https://b' } }

  it('finds the topmost link, with tolerance', () => {
    expect(linkAt([a, b], [50, 50])).toBe(b)
    expect(linkAt([a, b], [10, 10])).toBe(a)
    expect(linkAt([b], [62, 50])).toBeNull()
    expect(linkAt([b], [62, 50], 3)).toBe(b)
  })
})

describe('linksOf', () => {
  it('reads a page once and retries after a failure', async () => {
    const getAnnotations = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([url('https://a')])
    const page = { getAnnotations } as unknown as PDFPageProxy
    await expect(linksOf(page)).rejects.toThrow('x')
    expect(await linksOf(page)).toHaveLength(1)
    await linksOf(page)
    expect(getAnnotations).toHaveBeenCalledTimes(2)
    expect(getAnnotations).toHaveBeenCalledWith({ intent: 'display' })
  })
})

describe('createLinkLookup', () => {
  it('answers undefined until the page links are loaded, null on empty pages', async () => {
    const pages: PageEntry[] = [
      { kind: 'source', source: 1, rotate: 0 },
      { kind: 'blank', width: 100, height: 100, rotate: 0 },
    ]
    const page = { getAnnotations: vi.fn(async () => [url('https://a')]) } as unknown as PDFPageProxy
    const getPage = vi.fn(async () => page)
    const at = createLinkLookup(() => pages, getPage)
    expect(at(0, [20, 15], 0)).toBeUndefined()
    await new Promise((r) => setTimeout(r))
    expect(at(0, [20, 15], 0)?.target).toEqual({ kind: 'url', url: 'https://a' })
    expect(at(0, [80, 80], 0)).toBeNull()
    expect(at(1, [20, 15], 0)).toBeNull()
    expect(at(5, [20, 15], 0)).toBeUndefined()
    expect(getPage).toHaveBeenCalledTimes(1)
    expect(getPage).toHaveBeenCalledWith(1)
  })
})

describe('resolveDestination', () => {
  const doc = {
    getDestination: vi.fn(async (id: string) => (id === 'sec' ? [{ num: 7, gen: 0 }, { name: 'XYZ' }, 72, 500, null] : null)),
    getPageIndex: vi.fn(async (ref: { num: number }) => (ref.num === 7 ? 2 : 0)),
  }

  it('resolves named and explicit destinations to a page and point', async () => {
    expect(await resolveDestination(doc, 'sec')).toEqual({ page: 2, left: 72, top: 500 })
    expect(await resolveDestination(doc, [{ num: 7, gen: 0 }, { name: 'FitH' }, 300])).toEqual({ page: 2, left: null, top: 300 })
    expect(await resolveDestination(doc, [{ num: 7, gen: 0 }, { name: 'FitR' }, 10, 20, 30, 40])).toEqual({ page: 2, left: 10, top: 40 })
    expect(await resolveDestination(doc, [{ num: 7, gen: 0 }, { name: 'Fit' }])).toEqual({ page: 2, left: null, top: null })
    // A page number instead of a reference.
    expect(await resolveDestination(doc, [4, { name: 'XYZ' }, null, null, 0])).toEqual({ page: 4, left: null, top: null })
  })

  it('gives null for unknown names and malformed destinations', async () => {
    expect(await resolveDestination(doc, 'missing')).toBeNull()
    expect(await resolveDestination(doc, [])).toBeNull()
    expect(await resolveDestination(doc, ['x', { name: 'Fit' }])).toBeNull()
  })
})
