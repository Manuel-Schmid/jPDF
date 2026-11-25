import { describe, expect, it } from 'vitest'
import type { Annotation, HighlightAnnotation, Quad, RGB, TextLineAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { textMarkupCommand } from '../../../src/tools/shared/textMarkup'

const q = (x1: number, x2: number, y1: number, y2: number): Quad => [x1, y2, x2, y2, x1, y1, x2, y1]
const yellow: RGB = [1, 0.922, 0.231]
const green: RGB = [0, 1, 0]
const red: RGB = [1, 0, 0]

const hl = (id: string, quads: Quad[], over: Partial<HighlightAnnotation> = {}): HighlightAnnotation => ({
  id, page: 0, sourceRef: null, modifiedAt: 'old', author: 'A', kind: 'highlight', quads, color: yellow, opacity: 0.4, ...over,
})
const line = (id: string, kind: 'underline' | 'strikeout', quads: Quad[], over: Partial<TextLineAnnotation> = {}): TextLineAnnotation => ({
  id, page: 0, sourceRef: null, modifiedAt: 'old', author: 'A', kind, quads, color: red, ...over,
})

const ids = (list: Annotation[]) => list.map((a) => a.id)
const quadsOf = (store: AnnotationStore, id: string) => (store.get(id) as HighlightAnnotation | TextLineAnnotation).quads

describe('textMarkupCommand: re-marking in another colour', () => {
  it('replaces fully covered markup of the same kind; one undo restores it', () => {
    const store = new AnnotationStore()
    const old = { ...hl('old', [q(10, 50, 100, 110)]), sourceRef: '7 0 R' }
    store.load([old])
    const cmd = textMarkupCommand(store, [hl('new', [q(10, 50, 100, 110)], { color: green, modifiedAt: 'now' })])
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['new'])
    cmd.undo(store)
    expect(ids(store.byPage(0))).toEqual(['old'])
    expect(store.get('old')).toEqual(old)
  })

  it('splits markup the new colour covers only in the middle into separate annotations', () => {
    const store = new AnnotationStore()
    const old = { ...hl('old', [q(10, 90, 100, 110), q(10, 40, 88, 98)]), sourceRef: '7 0 R' }
    store.load([old])
    const cmd = textMarkupCommand(store, [hl('new', [q(40, 60, 100, 110)], { color: green, modifiedAt: 'now' })])
    cmd.do(store)
    const [first, piece, fresh] = store.byPage(0)
    expect([first.id, fresh.id]).toEqual(['old', 'new'])
    // Before the cut: the old annotation; after it (rest of line 1 and line 2): a new one.
    expect(quadsOf(store, 'old')).toEqual([q(10, 40, 100, 110)])
    expect(store.get('old')!.modifiedAt).toBe('now')
    expect(piece).toEqual({ ...old, id: piece.id, sourceRef: null, modifiedAt: 'now', quads: [q(60, 90, 100, 110), q(10, 40, 88, 98)] })
    expect(piece.id).not.toBe('old')
    cmd.undo(store)
    expect(ids(store.byPage(0))).toEqual(['old'])
    expect(store.get('old')).toEqual(old)
  })

  it('splits underlines and strike-outs re-marked in the middle the same way', () => {
    for (const kind of ['underline', 'strikeout'] as const) {
      const store = new AnnotationStore()
      store.load([line('old', kind, [q(10, 90, 100, 110)])])
      textMarkupCommand(store, [line('new', kind, [q(40, 60, 100, 110)], { color: green })]).do(store)
      const list = store.byPage(0) as TextLineAnnotation[]
      expect(list.map((a) => a.quads)).toEqual([[q(10, 40, 100, 110)], [q(60, 90, 100, 110)], [q(40, 60, 100, 110)]])
      expect(list.map((a) => a.kind)).toEqual([kind, kind, kind])
      expect(list.map((a) => a.color)).toEqual([red, red, green])
    }
  })

  it('treats another opacity of the same highlight colour as another style', () => {
    const store = new AnnotationStore()
    store.load([hl('old', [q(10, 50, 100, 110)])])
    textMarkupCommand(store, [hl('new', [q(30, 50, 100, 110)], { opacity: 0.8 })]).do(store)
    expect(quadsOf(store, 'old')).toEqual([q(10, 30, 100, 110)])
    expect(ids(store.byPage(0))).toEqual(['old', 'new'])
  })

  it('cuts several old annotations and merges with same-style markup in one undo step', () => {
    const store = new AnnotationStore()
    const yellowA = hl('ya', [q(10, 50, 100, 110)])
    const pinkB = hl('pb', [q(60, 100, 100, 110)], { color: [1, 0, 1] })
    const greenC = hl('gc', [q(110, 150, 100, 110)], { color: green })
    store.load([yellowA, pinkB, greenC])
    // Green over the end of yellow, all of pink, and up to the old green.
    const cmd = textMarkupCommand(store, [hl('new', [q(40, 110, 100, 110)], { color: green, modifiedAt: 'now' })])
    expect(cmd.label).toBe('Add annotation')
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['ya', 'gc'])
    expect(quadsOf(store, 'ya')).toEqual([q(10, 40, 100, 110)])
    expect(quadsOf(store, 'gc')).toEqual([q(40, 150, 100, 110)])
    cmd.undo(store)
    expect(ids(store.byPage(0))).toEqual(['ya', 'pb', 'gc'])
    expect(store.get('ya')).toEqual(yellowA)
    expect(store.get('pb')).toEqual(pinkB)
    expect(store.get('gc')).toEqual(greenC)
  })

  it('works the same for underlines and strike-outs', () => {
    for (const kind of ['underline', 'strikeout'] as const) {
      const store = new AnnotationStore()
      store.load([line('old', kind, [q(10, 50, 100, 110)])])
      const cmd = textMarkupCommand(store, [line('new', kind, [q(30, 70, 100, 110)], { color: green })])
      cmd.do(store)
      expect(ids(store.byPage(0))).toEqual(['old', 'new'])
      expect(quadsOf(store, 'old')).toEqual([q(10, 30, 100, 110)])
      cmd.undo(store)
      expect(quadsOf(store, 'old')).toEqual([q(10, 50, 100, 110)])
    }
  })

  it('leaves other kinds, other pages and flattened markup alone', () => {
    const store = new AnnotationStore()
    const under = line('under', 'underline', [q(10, 50, 100, 110)])
    const strike = line('strike', 'strikeout', [q(10, 50, 100, 110)])
    const otherPage = hl('p1', [q(10, 50, 100, 110)], { page: 1 })
    const flat = hl('flat', [q(10, 50, 100, 110)], { flattened: true })
    store.load([under, strike, otherPage, flat])
    const cmd = textMarkupCommand(store, [hl('new', [q(10, 50, 100, 110)], { color: green })])
    expect(cmd.label).toBe('Add annotation')
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['under', 'strike', 'flat', 'new'])
    expect(store.get('under')).toEqual(under)
    expect(store.get('strike')).toEqual(strike)
    expect(store.get('flat')).toEqual(flat)
    expect(store.get('p1')).toEqual(otherPage)
  })

  it('leaves markup on other lines and beside the new text alone', () => {
    const store = new AnnotationStore()
    const old = hl('old', [q(10, 40, 100, 110), q(10, 50, 88, 98)])
    store.load([old])
    textMarkupCommand(store, [hl('new', [q(40, 60, 100, 110)], { color: green })]).do(store)
    expect(store.get('old')).toEqual(old)
  })
})
