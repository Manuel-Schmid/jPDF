<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { HighlightAnnotation } from '../../core/session/model'
  import { quadOutline } from '../../core/geometry/quads'
  import { annotationView } from '../../core/viewer/annotationView.svelte'

  let { a, vp }: { a: HighlightAnnotation; vp: PageViewport; selected: boolean } = $props()

  const color = $derived(`rgb(${a.color.map((c) => Math.round(c * 255)).join(',')})`)
  const polygons = $derived(
    a.quads.map((q) =>
      quadOutline(q)
        .map(([x, y]) => vp.convertToViewportPoint(x, y).join(','))
        .join(' '),
    ),
  )
  /** Memory mode: drawn opaque, in full colour, so the text under it can't be read until clicked. */
  const covered = $derived(annotationView.covers(a.id))
</script>

<!-- Opacity on the group over opaque polygons: overlapping quads are not
     darkened twice, as in the saved appearance. -->
<g
  class:covered
  data-reveal={covered ? a.id : undefined}
  opacity={!covered && a.opacity < 1 ? a.opacity : undefined}
  style:mix-blend-mode={covered ? undefined : 'multiply'}
>
  {#each polygons as points, i (i)}
    <polygon {points} fill={color} />
  {/each}
</g>

<style>
  /*
   * Takes the pointer even while the overlay passes input through: a press
   * reveals it (see Overlay) instead of selecting the text under it.
   */
  .covered {
    pointer-events: auto;
    cursor: pointer;
  }
</style>
