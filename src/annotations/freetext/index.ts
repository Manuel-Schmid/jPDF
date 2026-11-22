import type { AnnotationKind } from '../../core/registry/annotationKinds'
import { rotatedBounds } from '../../core/geometry/rotation'
import type { FreeTextAnnotation } from '../../core/session/model'
import { turnBox, turnOf, unturned } from '../turnedBox'
import Render from './Render.svelte'

export const freetextKind: AnnotationKind<FreeTextAnnotation> = {
  kind: 'freetext',
  Render,
  bounds: (a) => rotatedBounds(a.rect, turnOf(a)),
  hitTest(a, p, tolerancePt) {
    const [x, y] = unturned(a, p)
    return x >= a.rect[0] - tolerancePt &&
      x <= a.rect[2] + tolerancePt &&
      y >= a.rect[1] - tolerancePt &&
      y <= a.rect[3] + tolerancePt
  },
  translate: (a, dx, dy) => ({
    ...a,
    rect: [a.rect[0] + dx, a.rect[1] + dy, a.rect[2] + dx, a.rect[3] + dy],
  }),
  rotate: turnBox,
}
