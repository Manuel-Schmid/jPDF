import { render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import '../../src/annotations'
import { annotationKinds } from '../../src/core/registry/annotationKinds'
import type {
  Annotation, FreeTextAnnotation, ImageAnnotation, InkAnnotation, LineAnnotation, ShapeAnnotation,
} from '../../src/core/session/model'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import Overlay from '../../src/core/viewer/Overlay.svelte'

const base = { page: 0, sourceRef: null, modifiedAt: '', author: '' }
const shape = (over: Partial<ShapeAnnotation> = {}): ShapeAnnotation => ({
  ...base, id: 's', kind: 'shape', shape: 'rect', rect: [0, 0, 40, 20],
  border: { color: [1, 0, 0], width: 2, opacity: 1 }, fill: null, ...over,
})
const image = (over: Partial<ImageAnnotation> = {}): ImageAnnotation => ({
  ...base, id: 'im', kind: 'image', rect: [0, 0, 40, 20], image: { width: 2, height: 1, png: 'AA' }, ...over,
})
const text = (over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation => ({
  ...base, id: 't', kind: 'freetext', rect: [0, 0, 40, 20], text: 'hi', lines: ['hi'], fontSize: 10,
  textColor: [0, 0, 0], background: null, align: 'left', ...over,
})
const ink: InkAnnotation = {
  ...base, id: 'i', kind: 'ink', strokes: [[[10, 0], [20, 0]]], color: [0, 0, 0], width: 2, opacity: 1,
  blend: 'normal', role: 'pen', pressure: [[0.2, 0.8]],
}
const line: LineAnnotation = {
  ...base, id: 'l', kind: 'line', points: [[10, 0], [20, 0]], arrow: true, border: { color: [0, 0, 0], width: 1, opacity: 1 },
}

const kindOf = (a: Annotation) => annotationKinds.get(a.kind)
const close = (p: readonly number[], q: readonly number[]) => p.forEach((v, i) => expect(v).toBeCloseTo(q[i], 9))

describe('rotating annotations', () => {
  it('turns ink and line points around the centre, keeping pressure and arrow', () => {
    const i = kindOf(ink).rotate!(ink, [0, 0], 90) as InkAnnotation
    close(i.strokes.flat(2), [0, 10, 0, 20])
    expect(i.pressure).toEqual(ink.pressure)
    expect('rotation' in i).toBe(false)
    const l = kindOf(line).rotate!(line, [0, 0], 90) as LineAnnotation
    close(l.points.flat(), [0, 10, 0, 20])
    expect(l.arrow).toBe(true)
  })

  it('turns boxes around their own centre by adding to their rotation', () => {
    for (const a of [shape(), image(), text()]) {
      const turned = kindOf(a).rotate!(a, [20, 10], 30) as ShapeAnnotation
      expect(turned.rect).toEqual(a.rect)
      expect(turned.rotation).toBe(30)
      const again = kindOf(a).rotate!(turned, [20, 10], 170) as ShapeAnnotation
      expect(again.rotation).toBe(-160)
    }
  })

  it('moves a box turned around another point, and drops a rotation back at 0', () => {
    const a = shape({ rotation: 90 })
    const turned = kindOf(a).rotate!(a, [0, 0], -90) as ShapeAnnotation
    // Centre (20, 10) turned clockwise around the origin → (10, -20).
    close(turned.rect, [-10, -30, 30, -10])
    expect('rotation' in turned).toBe(false)
  })

  it('has the turned box as bounds and hit area', () => {
    const t = text({ rotation: 90 })
    close(kindOf(t).bounds(t), [10, -10, 30, 30])
    // Inside the turned box, outside the unturned one, and the reverse.
    expect(kindOf(t).hitTest(t, [20, 28], 0)).toBe(true)
    expect(kindOf(t).hitTest(t, [2, 10], 0)).toBe(false)
    const im = image({ rotation: 90 })
    expect(kindOf(im).hitTest(im, [20, 28], 0)).toBe(true)
    expect(kindOf(im).hitTest(im, [2, 10], 0)).toBe(false)
    // Shapes: the stroke half width grows the turned box.
    const s = shape({ rotation: 90 })
    close(kindOf(s).bounds(s), [9, -11, 31, 31])
    expect(kindOf(s).hitTest(s, [10, 0], 0.5)).toBe(true) // on the turned outline
    expect(kindOf(s).hitTest(s, [20, 10], 0.5)).toBe(false) // empty inside
    expect(kindOf(s).hitTest(s, [0, 10], 0.5)).toBe(false) // the unturned outline
  })

  it('draws turned boxes turned around their screen centre', () => {
    // Page 100pt tall, scale 2: screen = (2x, 2(100 - y)).
    const vp = {
      scale: 2, width: 200, height: 200, rotation: 0,
      convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
      convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
    } as unknown as PageViewport
    for (const a of [shape({ rotation: 30 }), image({ rotation: 30 }), text({ rotation: 30 })]) {
      const store = new AnnotationStore()
      store.add(a)
      const c = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp } }).container
      // rect [0, 0, 40, 20] → screen [0, 160, 80, 200], centre (40, 180).
      expect(c.querySelector('svg > g')!.getAttribute('transform')).toBe('rotate(-30 40 180)')
    }
  })
})
