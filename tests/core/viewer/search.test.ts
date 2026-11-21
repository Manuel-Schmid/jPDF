import { describe, expect, it } from 'vitest'
import {
  buildPageText,
  findAll,
  hitQuads,
  itemQuad,
  normalizeQuery,
  quadsBounds,
  quadToViewport,
  revealScroll,
  type TextGeom,
} from '../../../src/core/viewer/search'
import type { TextContent } from '../../../src/core/viewer/textContent'

/** A horizontal text item at (x, y), 10 pt font, 6 pt per character. */
function item(str: string, x = 0, y = 0, hasEOL = false) {
  return { str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width: str.length * 6, height: 10, fontName: 'F1', hasEOL }
}

function content(items: unknown[], styles: Record<string, unknown> = {}) {
  return { items, styles } as unknown as TextContent
}

describe('buildPageText', () => {
  it('lower-cases and joins items, a line break becoming one space', () => {
    const t = buildPageText(content([item('Hello', 0, 0, true), item('World')]))
    expect(t.text).toBe('hello world')
    // The line break maps to no item.
    expect(t.item[5]).toBe(-1)
    expect(t.item[6]).toBe(1)
    expect(t.offset[6]).toBe(0)
  })

  it('collapses runs of whitespace, inside and between items', () => {
    const t = buildPageText(content([item('a  b', 0, 0, true), item(' ', 0, 0, true), item('\tc')]))
    expect(t.text).toBe('a b c')
  })

  it('skips marked content and empty items', () => {
    const t = buildPageText(content([{ type: 'beginMarkedContent' }, item('x'), item(''), item('y')]))
    expect(t.text).toBe('xy')
    expect(Array.from(t.item)).toEqual([0, 2])
  })

  it('takes the font ascent from the text style', () => {
    const styles = { F1: { ascent: 0.9, descent: -0.1 }, F2: { descent: -0.25 } }
    const t = buildPageText(content([item('a'), { ...item('b'), fontName: 'F2' }, { ...item('c'), fontName: 'F3' }], styles))
    expect(t.items.map((g) => g.ascent)).toEqual([0.9, 0.75, 0.8])
  })
})

describe('normalizeQuery / findAll', () => {
  it('normalizes like the page text', () => {
    expect(normalizeQuery('  Foo \n  Bar ')).toBe('foo bar')
  })

  it('finds non-overlapping occurrences, across line breaks', () => {
    const t = buildPageText(content([item('aa a', 0, 0, true), item('aaa')]))
    expect(findAll(t.text, 'aa')).toEqual([0, 5])
    const lines = buildPageText(content([item('Foo', 0, 0, true), item('bar')]))
    expect(findAll(lines.text, normalizeQuery('foo\nBAR'))).toEqual([0])
    expect(findAll(t.text, '')).toEqual([])
  })
})

describe('hit geometry', () => {
  it('cuts an item box proportionally to the characters', () => {
    const g: TextGeom = { str: 'abcd', transform: [10, 0, 0, 10, 100, 200], width: 40, height: 10, ascent: 0.8 }
    // Characters 1..3: x 110..130, from 2 below the baseline to 8 above.
    expect(itemQuad(g, 1, 3)).toEqual([110, 198, 130, 198, 130, 208, 110, 208])
  })

  it('follows rotated text', () => {
    const g: TextGeom = { str: 'ab', transform: [0, 10, -10, 0, 50, 50], width: 20, height: 10, ascent: 1 }
    const q = itemQuad(g, 0, 2)!.map((v) => Math.round(v * 1e6) / 1e6 + 0)
    expect(q).toEqual([50, 50, 50, 70, 40, 70, 40, 50])
  })

  it('has no box for an item without size', () => {
    expect(itemQuad({ str: 'a', transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0, ascent: 0.8 }, 0, 1)).toBeNull()
  })

  it('gives one quad per item a hit spans', () => {
    const t = buildPageText(content([item('foo bar', 0, 0, true), item('baz qux', 0, -20)]))
    const at = findAll(t.text, 'bar baz')[0]
    const quads = hitQuads(t, at, at + 'bar baz'.length)
    expect(quads).toHaveLength(2)
    expect(quads[0][0]).toBe(24) // "bar" starts at character 4 of item 0
    expect(quads[1][2]).toBe(18) // "baz" ends after character 3 of item 1
  })

  it('maps quads to the viewport and bounds them', () => {
    const vp = { convertToViewportPoint: (x: number, y: number) => [x * 2, 100 - y * 2] }
    const v = quadToViewport([0, 0, 10, 0, 10, 5, 0, 5], vp)
    expect(v).toEqual([0, 100, 20, 100, 20, 90, 0, 90])
    expect(quadsBounds([v])).toEqual({ left: 0, top: 90, right: 20, bottom: 100 })
  })
})

describe('revealScroll', () => {
  const view = { top: 1000, left: 0, width: 800, height: 600 }

  it('keeps the position when the box is in view', () => {
    expect(revealScroll({ left: 10, right: 50, top: 1100, bottom: 1120 }, view)).toEqual({ top: 1000, left: 0 })
  })

  it('puts a box out of view a third of the way down', () => {
    expect(revealScroll({ left: 10, right: 50, top: 3000, bottom: 3020 }, view)).toEqual({ top: 2800, left: 0 })
    expect(revealScroll({ left: 10, right: 50, top: 50, bottom: 70 }, view)).toEqual({ top: 0, left: 0 })
  })

  it('centres a box that is out of view horizontally', () => {
    expect(revealScroll({ left: 1500, right: 1600, top: 1100, bottom: 1120 }, view)).toEqual({ top: 1000, left: 1150 })
  })
})
