import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { isUpright, selectableBox } from '../../src/annotations/freetext/selectable'
import { measureHelvetica } from '../../src/core/geometry/textLayout'
import type { FreeTextAnnotation } from '../../src/core/session/model'

// Page 100pt tall at scale 2.
const vp = {
  scale: 2,
  rotation: 0,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
} as unknown as PageViewport

function box(over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation {
  return {
    id: 't1',
    page: 0,
    sourceRef: null,
    modifiedAt: '',
    author: '',
    kind: 'freetext',
    rect: [10, 50, 60, 70],
    text: 'Hello\n\nworld',
    lines: ['Hello', '', 'world'],
    fontSize: 10,
    textColor: [0, 0, 0],
    background: null,
    align: 'left',
    ...over,
  }
}

describe('selectableBox (the text of a box laid out as Render draws it)', () => {
  it('places each line box so its baseline sits on the rendered baseline; blank lines left out', () => {
    const b = selectableBox(box(), vp)
    expect(b).toMatchObject({ id: 't1', left: 20, top: 60, width: 100, height: 40, fontSize: 20 })
    // Render's first baseline: top + (TEXT_PADDING 1.5 + ASCENT 0.8 × 10) × 2 = 79 px;
    // a 1.2 line box puts Arial's baseline 0.946 em (ASCENT + EDITOR_BASELINE_SHIFT) below its top.
    expect(b.lines.map((l) => l.text)).toEqual(['Hello', 'world'])
    expect(b.lines[0].left).toBeCloseTo(23)
    expect(b.lines[0].top).toBeCloseTo(79 - 0.946 * 20)
    // "world" is the third line: two line heights (1.2 × 20 px) further down.
    expect(b.lines[1].top).toBeCloseTo(79 + 48 - 0.946 * 20)
  })

  it('right- and centre-aligned lines start where Render starts them', () => {
    const inner = 50 - 3 // box width (pt) minus the padding on both sides
    const free = inner - measureHelvetica('Hello', 10)
    expect(selectableBox(box({ align: 'right' }), vp).lines[0].left).toBeCloseTo(20 + (1.5 + free) * 2)
    expect(selectableBox(box({ align: 'center' }), vp).lines[0].left).toBeCloseTo(20 + (1.5 + free / 2) * 2)
  })

  it('carries the box style', () => {
    expect(selectableBox(box({ bold: true, italic: true }), vp)).toMatchObject({ fontWeight: 'bold', fontStyle: 'italic' })
    expect(selectableBox(box(), vp)).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal' })
  })
})

describe('isUpright', () => {
  it('only unturned boxes (turned ones are not markable yet)', () => {
    expect(isUpright(box())).toBe(true)
    expect(isUpright(box({ rotation: 0 }))).toBe(true)
    expect(isUpright(box({ rotation: 360 }))).toBe(true)
    expect(isUpright(box({ rotation: 90 }))).toBe(false)
    expect(isUpright(box({ rotation: 15 }))).toBe(false)
  })
})
