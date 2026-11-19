import { describe, expect, it } from 'vitest'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageEntry } from '../../../src/core/session/pages'
import { createTextLookup, onTextBox, textBoxes } from '../../../src/core/viewer/textBoxes'
import type { TextContent } from '../../../src/core/viewer/textContent'

/** A pdf.js text item: `size` pt font at (x, y) running along (dx, dy). */
function item(str: string, x: number, y: number, width: number, size = 10, [dx, dy] = [1, 0]) {
  return { str, transform: [dx * size, dy * size, -dy * size, dx * size, x, y], width, height: size, dir: 'ltr', hasEOL: false, fontName: 'f' }
}
const items = (...list: ReturnType<typeof item>[]) => list as unknown as TextContent['items']

describe('textBoxes', () => {
  it('boxes each non-blank run from below the baseline (descenders) to its height', () => {
    const [box] = textBoxes(items(item('Hello', 100, 700, 40), item('   ', 0, 0, 10)))
    expect(box.u).toEqual([40, 0])
    expect(box.origin).toEqual([100, 697.5])
    expect(box.v[1]).toBeCloseTo(12.5)
    expect(onTextBox([120, 705], box)).toBe(true)
    expect(onTextBox([120, 698], box)).toBe(true)
    expect(onTextBox([120, 715], box)).toBe(false)
    expect(onTextBox([145, 705], box)).toBe(false)
    expect(onTextBox([142, 705], box, 3)).toBe(true)
  })

  it('follows rotated text', () => {
    // Running up the page: x is "up" (towards -x), y is along.
    const [box] = textBoxes(items(item('Up', 100, 100, 30, 10, [0, 1])))
    expect(onTextBox([95, 115], box)).toBe(true)
    expect(onTextBox([105, 115], box)).toBe(false)
    expect(onTextBox([95, 135], box)).toBe(false)
  })
})

describe('createTextLookup', () => {
  const page = { getTextContent: async () => ({ items: items(item('Hi', 10, 10, 20)) }) } as unknown as PDFPageProxy

  it('answers null until the page text has loaded, then where the text is', async () => {
    const pages: PageEntry[] = [{ kind: 'source', source: 0, rotate: 0 }]
    const lookup = createTextLookup(() => pages, async () => page)
    expect(lookup(0, [15, 12], 0)).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(lookup(0, [15, 12], 0)).toBe(true)
    expect(lookup(0, [15, 50], 0)).toBe(false)
  })

  it('empty pages have no text; unknown pages and unreadable text stay unknown', async () => {
    const pages: PageEntry[] = [{ kind: 'blank', width: 10, height: 10, rotate: 0 }, { kind: 'source', source: 1, rotate: 0 }]
    const lookup = createTextLookup(() => pages, async () => Promise.reject(new Error('gone')))
    expect(lookup(0, [1, 1], 0)).toBe(false)
    expect(lookup(5, [1, 1], 0)).toBeNull()
    lookup(1, [1, 1], 0)
    await new Promise((r) => setTimeout(r, 0))
    expect(lookup(1, [1, 1], 0)).toBeNull()
    expect(createTextLookup(() => undefined, () => undefined)(0, [1, 1], 0)).toBeNull()
  })
})
