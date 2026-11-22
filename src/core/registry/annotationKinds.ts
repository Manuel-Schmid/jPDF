import type { Component } from 'svelte'
import type { PageViewport } from 'pdfjs-dist'
import type { Annotation, Point, Rect } from '../session/model'

export interface AnnotationKind<A extends Annotation = Annotation> {
  kind: A['kind']
  /** Renders an SVG <g>. */
  Render: Component<{ a: A; vp: PageViewport; selected: boolean }>
  /** Bounding box in PDF space. */
  bounds(a: A): Rect
  hitTest(a: A, p: Point, tolerancePt: number): boolean
  translate(a: A, dx: number, dy: number): A
  scale?(a: A, from: Rect, to: Rect): A
  /**
   * The box `scale` maps when resizing, if not the bounds less half the
   * stroke width (e.g. lines: their points' box, without the arrowhead).
   */
  scaleFrame?(a: A): Rect
  /**
   * `a` turned by `deg` (counter-clockwise, see core/geometry/rotation.ts)
   * around `centre` (PDF). Kinds without it cannot be rotated (text markup
   * follows its text).
   */
  rotate?(a: A, centre: Point, deg: number): A
}

const kinds = new Map<string, AnnotationKind>()

export const annotationKinds = {
  register<A extends Annotation>(k: AnnotationKind<A>): void {
    kinds.set(k.kind, k as unknown as AnnotationKind)
  },
  get(kind: string): AnnotationKind {
    const k = kinds.get(kind)
    if (!k) throw new Error(`Unknown annotation kind: ${kind}`)
    return k
  },
}
