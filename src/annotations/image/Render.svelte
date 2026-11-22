<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { ImageAnnotation } from '../../core/session/model'
  import { screenBox, turnTransform } from '../freetext/screen'

  let { a, vp }: { a: ImageAnnotation; vp: PageViewport; selected: boolean } = $props()

  // Laid out in screen space, so the image is upright on rotated pages like the
  // saved appearance (which counter-rotates it), stretched to fill its box.
  const box = $derived(screenBox(a.rect, vp))
  const href = $derived(`data:image/png;base64,${a.image.png}`)
</script>

<g transform={turnTransform(a.rect, a.rotation, vp)}>
  <image {href} x={box.left} y={box.top} width={box.width} height={box.height} preserveAspectRatio="none" />
</g>
