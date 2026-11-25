import { describe, expect, it } from 'vitest'
import {
  cutQuadGroups,
  cutQuads,
  findMergeableTextMarkup,
  findMergeableMarkerStrokes,
  mergeHighlightQuads,
  sameStyle,
} from '../../../src/core/geometry/merge'
import type { Annotation, HighlightAnnotation, InkAnnotation, Point, Quad } from '../../../src/core/session/model'

/** Upright quad (PDF y up) from x1..x2 and y1 (bottom)..y2 (top), QuadPoints order TL, TR, BL, BR. */
const q = (x1: number, x2: number, y1: number, y2: number): Quad => [x1, y2, x2, y2, x1, y1, x2, y1]

const hl = (id: string, quads: Quad[], over: Partial<HighlightAnnotation> = {}): HighlightAnnotation => ({
  id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
  quads, color: [1, 0.922, 0.231], opacity: 0.4, ...over,
})

const ink = (id: string, strokes: Point[][], over: Partial<InkAnnotation> = {}): InkAnnotation => ({
  id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
  strokes, color: [1, 0.922, 0.231], width: 10, opacity: 0.4, blend: 'multiply', role: 'marker', ...over,
})

describe('mergeHighlightQuads', () => {
  it('merges overlapping and touching quads on one line into one quad', () => {
    expect(mergeHighlightQuads([q(10, 50, 100, 110), q(40, 90, 100, 110)])).toEqual([q(10, 90, 100, 110)])
    // 0.5 pt gap: touching.
    expect(mergeHighlightQuads([q(10, 50, 100, 110), q(50.5, 90, 100, 110)])).toEqual([q(10, 90, 100, 110)])
  })

  it('keeps separate fragments and other lines apart', () => {
    const apart = [q(10, 50, 100, 110), q(65, 90, 100, 110)]
    expect(mergeHighlightQuads(apart)).toEqual([q(10, 50, 100, 110), q(65, 90, 100, 110)])
    const lines = [q(10, 50, 100, 110), q(10, 50, 88, 99)]
    expect(mergeHighlightQuads(lines)).toEqual(lines)
  })

  it('merges neighboring words separated by a single word space proportional to height', () => {
    // 10 pt height -> bridges up to 6 pt gap.
    expect(mergeHighlightQuads([q(10, 50, 100, 110), q(54, 90, 100, 110)])).toEqual([q(10, 90, 100, 110)])
    // Larger font (20 pt height) bridges an 8 pt word space, whereas 10 pt height does not.
    expect(mergeHighlightQuads([q(10, 50, 100, 120), q(58, 90, 100, 120)])).toEqual([q(10, 90, 100, 120)])
    const wide = [q(10, 50, 100, 110), q(58, 90, 100, 110)]
    expect(mergeHighlightQuads(wide)).toEqual(wide)
  })

  it('joins same-line quads only when their heights are within 30%', () => {
    // Same centre line, heights 12 and 6: a union would cover unhighlighted height.
    const tallShort = [q(10, 50, 100, 112), q(40, 90, 103, 109)]
    expect(mergeHighlightQuads(tallShort)).toEqual(tallShort)
    // Heights 10 and 9: joined.
    expect(mergeHighlightQuads([q(10, 50, 100, 110), q(40, 90, 100.5, 109.5)])).toEqual([q(10, 90, 100, 110)])
  })

  it('merges in a chain once a union reaches another fragment', () => {
    expect(mergeHighlightQuads([q(60, 80, 100, 110), q(10, 30, 100, 110), q(25, 65, 100, 110)])).toEqual([
      q(10, 80, 100, 110),
    ])
  })

  it('merges quads of a rotated page (vertical lines) keeping their orientation', () => {
    // Rotate 90: text runs along +y, "down" on screen is +x. TL=(x1,y1) TR=(x1,y2) BL=(x2,y1) BR=(x2,y2).
    const v = (x1: number, x2: number, y1: number, y2: number): Quad => [x1, y1, x1, y2, x2, y1, x2, y2]
    expect(mergeHighlightQuads([v(100, 110, 10, 50), v(100, 110, 45, 80)])).toEqual([v(100, 110, 10, 80)])
    // Neighboring words on a rotated page (4 pt word space on 10 pt height).
    expect(mergeHighlightQuads([v(100, 110, 10, 50), v(100, 110, 54, 80)])).toEqual([v(100, 110, 10, 80)])
  })

  it('leaves quads that are not axis-aligned as they are', () => {
    const skew: Quad = [0, 10, 10, 12, 0, 0, 10, 2]
    expect(mergeHighlightQuads([skew, q(0, 10, 0, 10)])).toEqual([q(0, 10, 0, 10), skew])
  })
})

describe('findMergeableTextMarkup', () => {
  const fresh = hl('new', [q(40, 90, 100, 110)])

  it('finds same-colour, same-opacity highlights whose quads overlap or touch, in z-order', () => {
    const a = hl('a', [q(10, 45, 100, 110)])
    const b = hl('b', [q(90.5, 120, 100, 110)])
    const far = hl('far', [q(200, 250, 100, 110)])
    expect(findMergeableTextMarkup([a, far, b], fresh).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('cascades: highlights connected to the new one through others join the group', () => {
    // new touches a, a touches c, c touches d; b only touches nothing.
    const a = hl('a', [q(85, 130, 100, 110)])
    const c = hl('c', [q(130.5, 160, 100, 110)])
    const d = hl('d', [q(160, 170, 88, 100.5)])
    const b = hl('b', [q(300, 320, 100, 110)])
    const green = hl('green', [q(129, 131, 100, 110)], { color: [0, 1, 0] })
    expect(findMergeableTextMarkup([d, b, green, c, a], fresh).map((x) => x.id)).toEqual(['d', 'c', 'a'])
  })

  it('a dark-background (normal-blended) highlight never merges with a multiply one', () => {
    const normal = hl('normal', [q(10, 45, 100, 110)], { blend: 'normal' })
    const plain = hl('plain', [q(10, 45, 100, 110)], { blend: 'multiply' })
    expect(findMergeableTextMarkup([normal, plain], fresh).map((x) => x.id)).toEqual(['plain'])
    const freshNormal = { ...fresh, blend: 'normal' as const }
    expect(findMergeableTextMarkup([normal, plain], freshNormal).map((x) => x.id)).toEqual(['normal'])
    // Absent counts as multiply.
    expect(sameStyle(hl('x', []), hl('y', [], { blend: 'multiply' }))).toBe(true)
  })

  it('ignores other colours, opacities, pages and kinds', () => {
    const list: Annotation[] = [
      hl('colour', [q(10, 45, 100, 110)], { color: [0, 1, 0] }),
      hl('opacity', [q(10, 45, 100, 110)], { opacity: 0.6 }),
      hl('page', [q(10, 45, 100, 110)], { page: 1 }),
      ink('ink', [[[50, 105], [60, 105]]]),
    ]
    expect(findMergeableTextMarkup(list, fresh)).toEqual([])
  })

  it('compares colours at 1/255 precision', () => {
    const a = hl('a', [q(10, 45, 100, 110)], { color: [1, 0.9221, 0.2309] })
    expect(findMergeableTextMarkup([a], fresh).map((x) => x.id)).toEqual(['a'])
  })

  it('connects neighboring words one word space apart across highlight, underline, and strikeout', () => {
    // fresh is x=40..90, height 10 -> bridges up to 6 pt gap on the same line.
    const nextHighlight = hl('next', [q(94, 130, 100, 110)])
    expect(findMergeableTextMarkup([nextHighlight], fresh).map((x) => x.id)).toEqual(['next'])

    for (const kind of ['underline', 'strikeout'] as const) {
      const a: Annotation = {
        id: 'u1', page: 0, sourceRef: null, modifiedAt: '', author: '', kind,
        quads: [q(10, 45, 100, 110)], color: [0.1, 0.5, 0.9],
      }
      const b: Annotation = { ...a, id: 'u2', quads: [q(49, 90, 100, 110)] }
      expect(findMergeableTextMarkup([a], b).map((x) => x.id)).toEqual(['u1'])
    }
  })

  it('does not connect words across wide gaps, adjacent lines, or mismatched heights', () => {
    const columnGap = hl('col', [q(105, 150, 100, 110)]) // 15 pt gap
    const nextLine = hl('line', [q(40, 90, 87, 97)]) // 3 pt vertical gap, 10 pt height
    const shortWord = hl('short', [q(93, 120, 102, 108)]) // height 6 vs 10 (40% diff)
    expect(findMergeableTextMarkup([columnGap, nextLine, shortWord], fresh)).toEqual([])
  })

  it('connects neighboring words on rotated pages along their text axis', () => {
    const v = (x1: number, x2: number, y1: number, y2: number): Quad => [x1, y1, x1, y2, x2, y1, x2, y2]
    const a = hl('rot1', [v(100, 110, 10, 50)])
    const b = hl('rot2', [v(100, 110, 54, 90)])
    expect(findMergeableTextMarkup([a], b).map((x) => x.id)).toEqual(['rot1'])
  })
})

describe('findMergeableMarkerStrokes', () => {
  const fresh = ink('new', [[[0, 0], [100, 0]]])

  it('finds marker strokes whose painted bands overlap or touch (distance <= width)', () => {
    const near = ink('near', [[[0, 10], [100, 10]]]) // 10 pt apart = width
    const cross = ink('cross', [[[50, -50], [50, 50]]])
    const far = ink('far', [[[0, 80], [100, 80]]]) // beyond every stroke of the group
    expect(findMergeableMarkerStrokes([near, far, cross], fresh).map((x) => x.id)).toEqual(['near', 'cross'])
    // Just beyond the width: separate.
    expect(findMergeableMarkerStrokes([ink('gap', [[[0, 10.5], [100, 10.5]]])], fresh)).toEqual([])
  })

  it('cascades through strokes connected to the new one via others', () => {
    // new (y=0) touches a (y=10), a touches c (y=20), c touches e (y=30); far does not connect.
    const a = ink('a', [[[0, 10], [100, 10]]])
    const c = ink('c', [[[0, 20], [100, 20]]])
    const e = ink('e', [[[0, 30], [100, 30]]])
    const far = ink('far', [[[0, 45], [100, 45]]])
    const pen = ink('pen', [[[0, 15], [100, 15]]], { role: 'pen', blend: 'normal' })
    expect(findMergeableMarkerStrokes([e, far, pen, c, a], fresh).map((x) => x.id)).toEqual(['e', 'c', 'a'])
  })

  it('handles single-point strokes', () => {
    const dot = ink('dot', [[[105, 5]]])
    expect(findMergeableMarkerStrokes([dot], fresh).map((x) => x.id)).toEqual(['dot'])
  })

  it('never merges pen strokes, other styles or highlights', () => {
    const over = [[[0, 0], [100, 0]]] as Point[][]
    const list: Annotation[] = [
      ink('pen', over, { role: 'pen', blend: 'normal' }),
      ink('colour', over, { color: [0, 0, 1] }),
      ink('opacity', over, { opacity: 0.5 }),
      ink('width', over, { width: 12 }),
      ink('page', over, { page: 2 }),
      hl('text', [q(0, 100, -5, 5)]),
    ]
    expect(findMergeableMarkerStrokes(list, fresh)).toEqual([])
    expect(findMergeableMarkerStrokes([ink('m', over)], { ...fresh, role: 'pen' })).toEqual([])
  })
})

describe('cutQuads', () => {
  it('cuts the middle out of a line, splitting the quad in two', () => {
    expect(cutQuads([q(10, 100, 50, 60)], [q(40, 60, 50, 60)])).toEqual([q(10, 40, 50, 60), q(60, 100, 50, 60)])
  })

  it('trims either end, removes covered quads, keeps untouched ones as they are', () => {
    const line1 = q(10, 100, 50, 60)
    const line2 = q(10, 80, 30, 40)
    const line3 = q(10, 90, 10, 20)
    const out = cutQuads([line1, line2, line3], [q(70, 120, 50, 60), q(0, 90, 30, 40)])
    expect(out).toEqual([q(10, 70, 50, 60), line3])
    expect(out[1]).toBe(line3)
  })

  it('only cuts on the same line (most of the height overlapping)', () => {
    const line = q(10, 100, 50, 60)
    // Overlaps 2 of 10pt: the line below, not this one.
    expect(cutQuads([line], [q(10, 100, 42, 52)])).toEqual([line])
    expect(cutQuads([line], [q(10, 50, 49, 59)])).toEqual([q(50, 100, 50, 60)])
  })

  it('drops slivers narrower than half a point', () => {
    expect(cutQuads([q(10, 100, 50, 60)], [q(10.3, 99.8, 50, 60)])).toEqual([])
  })

  it('cuts rotated (axis-aligned) text along its own axis', () => {
    // Text running up: TL (60,10) TR (60,100) BL (50,10) BR (50,100).
    const up: Quad = [60, 10, 60, 100, 50, 10, 50, 100]
    const cut: Quad = [60, 40, 60, 70, 50, 40, 50, 70]
    expect(cutQuads([up], [cut])).toEqual([
      [60, 10, 60, 40, 50, 10, 50, 40],
      [60, 70, 60, 100, 50, 70, 50, 100],
    ])
  })

  it('removes a skewed quad whole when a cut touches it', () => {
    const skew: Quad = [0, 10, 10, 12, 0, 0, 10, 2]
    expect(cutQuads([skew], [q(5, 6, 4, 6)])).toEqual([])
    expect(cutQuads([skew], [q(50, 60, 4, 6)])).toEqual([skew])
  })
})

describe('cutQuadGroups', () => {
  // Three lines, top to bottom (reading order).
  const line1 = q(10, 100, 50, 60)
  const line2 = q(10, 100, 30, 40)
  const line3 = q(10, 100, 10, 20)

  it('splits a line cut in the middle into two pieces', () => {
    expect(cutQuadGroups([line1], [q(40, 60, 50, 60)])).toEqual([[q(10, 40, 50, 60)], [q(60, 100, 50, 60)]])
  })

  it('splits a multi-line marking at a cut in its middle line, keeping untouched lines together', () => {
    expect(cutQuadGroups([line1, line2, line3], [q(40, 60, 30, 40)])).toEqual([
      [line1, q(10, 40, 30, 40)],
      [q(60, 100, 30, 40), line3],
    ])
  })

  it('splits where a whole line was removed, or a line end and the next start', () => {
    expect(cutQuadGroups([line1, line2, line3], [q(0, 120, 30, 40)])).toEqual([[line1], [line3]])
    // From the end of line 1 to the start of line 2.
    expect(cutQuadGroups([line1, line2, line3], [q(70, 120, 50, 60), q(0, 30, 30, 40)])).toEqual([
      [q(10, 70, 50, 60)],
      [q(30, 100, 30, 40), line3],
    ])
  })

  it('keeps one piece when only the start or end is trimmed', () => {
    expect(cutQuadGroups([line1, line2, line3], [q(0, 40, 50, 60)])).toEqual([[q(40, 100, 50, 60), line2, line3]])
    expect(cutQuadGroups([line1, line2, line3], [q(0, 120, 10, 20)])).toEqual([[line1, line2]])
    expect(cutQuadGroups([line1, line2], [q(60, 120, 30, 40)])).toEqual([[line1, q(10, 60, 30, 40)]])
  })

  it('returns untouched input as one piece of the same quads, and nothing when all is cut', () => {
    const out = cutQuadGroups([line1, line2], [q(10, 100, 80, 90)])
    expect(out).toEqual([[line1, line2]])
    expect(out[0][0]).toBe(line1)
    expect(cutQuadGroups([line1, line2], [q(0, 120, 30, 60)])).toEqual([])
  })

  it('splits where a skewed quad was removed whole', () => {
    const skew: Quad = [0, 40, 10, 42, 0, 30, 10, 32]
    expect(cutQuadGroups([line1, skew, line3], [q(5, 6, 34, 36)])).toEqual([[line1], [line3]])
  })
})
