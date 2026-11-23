import { describe, expect, it } from 'vitest'
import type { ScreenRect } from '../../../src/core/geometry/quads'
import {
  caretOffset,
  focusLine,
  groupLines,
  nearestSpan,
  spanAt,
} from '../../../src/tools/shared/textLines'

const box = (left: number, top: number, right: number, bottom: number): ScreenRect => ({
  left,
  top,
  right,
  bottom,
})
const band = { ratio: 0.5, min: 4 }

/** Two lines of two spans, 10 high with a 10 gap. */
const lines = groupLines([
  { box: box(10, 100, 60, 110), item: 'a' },
  { box: box(62, 100, 120, 110), item: 'b' },
  { box: box(10, 120, 80, 130), item: 'c' },
  { box: box(90, 120, 120, 130), item: 'd' },
])

describe('groupLines', () => {
  it('joins consecutive spans of one line and starts a new line below', () => {
    expect(lines.map((l) => l.spans.map((s) => s.item))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(lines[0].box).toEqual(box(10, 100, 120, 110))
  })

  it('splits a line at a wide gap (columns, table cells)', () => {
    const row = groupLines([
      { box: box(0, 0, 50, 10), item: 'cell 1' },
      { box: box(54, 0, 80, 10), item: 'cell 1 more' },
      { box: box(200, 0, 250, 10), item: 'cell 2' },
    ])
    expect(row.map((l) => l.spans.length)).toEqual([2, 1])
  })

  it('keeps side-by-side columns apart (their spans are not consecutive)', () => {
    const cols = groupLines([
      { box: box(0, 0, 50, 10), item: 'left 1' },
      { box: box(0, 20, 50, 30), item: 'left 2' },
      { box: box(100, 0, 150, 10), item: 'right 1' },
    ])
    expect(cols).toHaveLength(3)
  })

  it('sorts a line’s spans left to right', () => {
    const l = groupLines([
      { box: box(50, 0, 90, 10), item: 'second' },
      { box: box(0, 1, 40, 11), item: 'first' },
    ])
    expect(l[0].spans.map((s) => s.item)).toEqual(['first', 'second'])
  })
})

describe('nearestSpan', () => {
  it('finds the span under the point', () => {
    expect(nearestSpan(lines, { x: 70, y: 105 }, 8)?.span.item).toBe('b')
  })

  it('finds a span a few units beside, before or after the text, and in a line gap', () => {
    expect(nearestSpan(lines, { x: 4, y: 105 }, 8)?.span.item).toBe('a')
    expect(nearestSpan(lines, { x: 126, y: 125 }, 8)?.span.item).toBe('d')
    expect(nearestSpan(lines, { x: 30, y: 112 }, 8)).toMatchObject({ line: 0, span: { item: 'a' } })
    expect(nearestSpan(lines, { x: 30, y: 118 }, 8)).toMatchObject({ line: 1, span: { item: 'c' } })
  })

  it('finds nothing further away than the tolerance', () => {
    expect(nearestSpan(lines, { x: 30, y: 150 }, 8)).toBeNull()
    expect(nearestSpan(lines, { x: 0, y: 105 }, 8)).toBeNull()
  })
})

describe('focusLine', () => {
  it('stays on the line while the pointer strays within the band above/below it', () => {
    expect(focusLine(lines, 0, { x: 50, y: 114 }, band)).toBe(0)
    expect(focusLine(lines, 0, { x: 50, y: 96 }, band)).toBe(0)
    // Already a little into the next line's box: still not clearly on it.
    expect(focusLine(lines, 1, { x: 50, y: 117 }, band)).toBe(1)
  })

  it('moves to a line the pointer is clearly on', () => {
    expect(focusLine(lines, 0, { x: 50, y: 125 }, band)).toBe(1)
    expect(focusLine(lines, 1, { x: 50, y: 104 }, band)).toBe(0)
  })

  it('outside the band but between lines: the nearer line', () => {
    expect(focusLine(lines, 0, { x: 50, y: 118 }, band)).toBe(1)
  })

  it('past the end of the text: the last line, not lost', () => {
    expect(focusLine(lines, 0, { x: 50, y: 400 }, band)).toBe(1)
  })

  it('without a current line (just entered a page): the line under or nearest the pointer', () => {
    expect(focusLine(lines, -1, { x: 50, y: 80 }, band)).toBe(0)
  })

  it('a pointer level with the line but far beside it (another column) is not on the line', () => {
    const cols = groupLines([
      { box: box(0, 0, 50, 10), item: 'left' },
      { box: box(200, 2, 250, 12), item: 'right' },
      { box: box(0, 20, 50, 30), item: 'left 2' },
    ])
    expect(focusLine(cols, 0, { x: 220, y: 6 }, band)).toBe(1)
  })
})

describe('spanAt', () => {
  it('the span under x, or the first/last span’s edge beside the line', () => {
    expect(spanAt(lines[0], 30)).toMatchObject({ span: { item: 'a' }, edge: null })
    expect(spanAt(lines[0], 0)).toMatchObject({ span: { item: 'a' }, edge: 'start' })
    expect(spanAt(lines[0], 200)).toMatchObject({ span: { item: 'b' }, edge: 'end' })
  })

  it('in a gap between spans: the nearer edge', () => {
    expect(spanAt(lines[1], 83)).toMatchObject({ span: { item: 'c' }, edge: 'end' })
    expect(spanAt(lines[1], 88)).toMatchObject({ span: { item: 'd' }, edge: 'start' })
  })
})

describe('caretOffset', () => {
  const centre = (i: number) => 5 + i * 10
  it('counts the characters whose centre is left of x', () => {
    expect(caretOffset(5, centre, 0)).toBe(0)
    expect(caretOffset(5, centre, 6)).toBe(1)
    expect(caretOffset(5, centre, 24)).toBe(2)
    expect(caretOffset(5, centre, 100)).toBe(5)
    expect(caretOffset(0, centre, 100)).toBe(0)
  })
})
