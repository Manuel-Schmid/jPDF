import { describe, expect, it } from 'vitest'
import { rectCentre, rotatePoint } from '../../../src/core/geometry/rotation'
import type { FreeTextAnnotation, Point, Rect } from '../../../src/core/session/model'
import { layoutFreeText } from '../../../src/tools/text/editing'

const box = (rect: Rect, rotation?: number): FreeTextAnnotation => ({
  id: 't', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext', rect, text: 'hi', lines: ['hi'],
  fontSize: 10, textColor: [0, 0, 0], background: null, align: 'left', ...(rotation === undefined ? {} : { rotation }),
})

/** The box's top-left corner as drawn: turned around the rect's centre. */
const corner = (a: FreeTextAnnotation): Point => rotatePoint([a.rect[0], a.rect[3]], rectCentre(a.rect), a.rotation ?? 0)

describe('text box layout', () => {
  it('keeps a turned box anchored at its turned top-left corner when more lines make it taller', () => {
    const a = box([10, 10, 60, 25], 30)
    const grown = layoutFreeText(a, 'one\ntwo\nthree', 0)
    expect(grown.lines).toEqual(['one', 'two', 'three'])
    expect(grown.rect[3] - grown.rect[1]).toBeGreaterThan(15)
    expect(grown.rect[2] - grown.rect[0]).toBeCloseTo(50)
    expect(grown.rotation).toBe(30)
    corner(grown).forEach((v, i) => expect(v).toBeCloseTo(corner(a)[i], 9))
  })

  it('keeps the top-left corner of an unturned box, as before', () => {
    const grown = layoutFreeText(box([10, 10, 60, 25]), 'one\ntwo\nthree', 0)
    expect(grown.rect[0]).toBe(10)
    expect(grown.rect[3]).toBe(25)
  })
})
