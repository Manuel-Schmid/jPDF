import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import SearchHighlights from '../../../src/core/viewer/SearchHighlights.svelte'
import type { PdfDoc } from '../../../src/core/viewer/pdfEngine'
import type { SearchHit } from '../../../src/core/viewer/search'

function fakeDoc() {
  return {
    getPage: vi.fn(async () => ({
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({
        convertToViewportPoint: (x: number, y: number) => [x * scale, (100 - y) * scale],
      }),
    })),
  } as unknown as PdfDoc
}

describe('SearchHighlights', () => {
  it('draws each hit box in viewport coordinates, the current hit marked', async () => {
    const a: SearchHit = { page: 0, quads: [[0, 0, 10, 0, 10, 5, 0, 5]] }
    const b: SearchHit = { page: 0, quads: [[20, 0, 30, 0, 30, 5, 20, 5]] }
    const { container } = render(SearchHighlights, {
      props: { doc: fakeDoc(), pageNumber: 1, scale: 2, hits: [a, b], current: b },
    })
    await vi.waitFor(() => expect(container.querySelectorAll('polygon')).toHaveLength(2))
    const [pa, pb] = container.querySelectorAll('polygon')
    expect(pa.getAttribute('points')).toBe('0,200,20,200,20,190,0,190')
    expect(pa.classList.contains('current')).toBe(false)
    expect(pb.classList.contains('current')).toBe(true)
  })

  it('draws nothing on an empty page', async () => {
    const doc = fakeDoc()
    const { container } = render(SearchHighlights, {
      props: {
        doc,
        pageNumber: 1,
        entry: { kind: 'blank', width: 100, height: 100, rotate: 0 },
        scale: 1,
        hits: [{ page: 0, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }],
      },
    })
    await Promise.resolve()
    expect(container.querySelectorAll('polygon')).toHaveLength(0)
    expect(doc.getPage).not.toHaveBeenCalled()
  })
})
