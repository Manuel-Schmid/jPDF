import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../src/annotations'
import { highlightKind } from '../../src/annotations/highlight'
import { annotationKinds } from '../../src/core/registry/annotationKinds'
import type { HighlightAnnotation } from '../../src/core/session/model'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import Overlay from '../../src/core/viewer/Overlay.svelte'

const hl = (over: Partial<HighlightAnnotation> = {}): HighlightAnnotation => ({
  id: 'h1', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
  quads: [
    [10, 90, 50, 90, 10, 80, 50, 80],
    [10, 70, 30, 70, 10, 60, 30, 60],
  ],
  color: [1, 1, 0], opacity: 0.4, ...over,
})

// Page 100pt tall, scale 2: screen = (2x, 2(100 - y)).
const vp = {
  scale: 2,
  width: 200,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
} as unknown as PageViewport

describe('highlight kind', () => {
  it('is registered', () => {
    expect(annotationKinds.get('highlight')).toBe(highlightKind)
  })

  it('renders one filled, multiplied polygon per quad', () => {
    const store = new AnnotationStore()
    store.add(hl())
    const { container } = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp } })
    const polys = container.querySelectorAll('polygon')
    expect(polys).toHaveLength(2)
    // TL, TR, BR, BL
    expect(polys[0].getAttribute('points')).toBe('20,20 100,20 100,40 20,40')
    expect(polys[0].getAttribute('fill')).toBe('rgb(255,255,0)')
    // Opacity on the group, opaque polygons: overlapping quads are not darkened twice.
    expect(polys[0].hasAttribute('fill-opacity')).toBe(false)
    expect(container.querySelector('g')!.getAttribute('opacity')).toBe('0.4')
    expect(container.querySelector('g')!.style.mixBlendMode).toBe('multiply')
  })

  it('a dark-background highlight is drawn normal-blended (no multiply)', () => {
    const store = new AnnotationStore()
    store.add(hl({ blend: 'normal' }))
    const { container } = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp } })
    expect(container.querySelector('g')!.getAttribute('opacity')).toBe('0.4')
    expect(container.querySelector('g')!.style.mixBlendMode).toBe('')
  })

  it('bounds is the union of the quads', () => {
    expect(highlightKind.bounds(hl())).toEqual([10, 60, 50, 90])
    expect(highlightKind.bounds(hl({ quads: [] }))).toEqual([0, 0, 0, 0])
  })

  it('hit-tests inside any quad, with tolerance', () => {
    const a = hl()
    expect(highlightKind.hitTest(a, [20, 85], 0)).toBe(true)
    expect(highlightKind.hitTest(a, [20, 65], 0)).toBe(true)
    expect(highlightKind.hitTest(a, [40, 65], 0)).toBe(false)
    expect(highlightKind.hitTest(a, [52, 85], 0)).toBe(false)
    expect(highlightKind.hitTest(a, [52, 85], 3)).toBe(true)
  })

  it('translate shifts every quad', () => {
    const moved = highlightKind.translate(hl({ quads: [[0, 10, 10, 10, 0, 0, 10, 0]] }), 5, -2)
    expect(moved.quads).toEqual([[5, 8, 15, 8, 5, -2, 15, -2]])
  })
})
