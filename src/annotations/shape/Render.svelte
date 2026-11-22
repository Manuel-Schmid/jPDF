<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { ShapeAnnotation } from '../../core/session/model'
  import { cssColor, screenBox, turnTransform } from '../freetext/screen'

  let { a, vp }: { a: ShapeAnnotation; vp: PageViewport; selected: boolean } = $props()

  // Axis-aligned on screen for page rotations 0/90/180/270. A circle resized
  // to a non-square box draws as an ellipse.
  const box = $derived(screenBox(a.rect, vp))
  const paint = $derived({
    fill: a.fill ? cssColor(a.fill.color) : 'none',
    'fill-opacity': a.fill?.opacity,
    stroke: a.border ? cssColor(a.border.color) : 'none',
    'stroke-width': a.border ? a.border.width * vp.scale : undefined,
    'stroke-opacity': a.border?.opacity,
  })
</script>

<g transform={turnTransform(a.rect, a.rotation, vp)}>
  {#if a.shape === 'circle'}
    <ellipse
      cx={box.left + box.width / 2}
      cy={box.top + box.height / 2}
      rx={box.width / 2}
      ry={box.height / 2}
      {...paint}
    />
  {:else}
    <rect x={box.left} y={box.top} width={box.width} height={box.height} {...paint} />
  {/if}
</g>
