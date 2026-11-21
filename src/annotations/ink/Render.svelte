<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { InkAnnotation, Point } from '../../core/session/model'
  import { smoothPath } from '../../core/geometry/stroke'
  import { inkOutlines, outlinePath } from '../../core/geometry/pressure'

  let { a, vp }: { a: InkAnnotation; vp: PageViewport; selected: boolean } = $props()

  const toScreen = (p: Point): Point => {
    const [x, y] = vp.convertToViewportPoint(p[0], p[1])
    return [x, y]
  }
  const color = $derived(`rgb(${a.color.map((c) => Math.round(c * 255)).join(',')})`)
  const multiply = $derived(a.blend === 'multiply')
  /**
   * Pressure strokes: their outlines in PDF space, computed once per
   * annotation (not on zoom, which only maps them to the screen).
   */
  const outlines = $derived(a.pressure ? inkOutlines(a) : null)
</script>

<!-- Opacity on the group over opaque strokes: where strokes cross (or one
     crosses itself) the area is not darkened twice, as in the saved appearance. -->
<g opacity={a.opacity < 1 ? a.opacity : undefined} style:mix-blend-mode={multiply ? 'multiply' : undefined}>
  {#if outlines}
    <!-- One filled path (nonzero): overlapping outlines are filled once. -->
    <path d={outlinePath(outlines, toScreen)} fill={color} />
  {:else}
    {#each a.strokes as stroke, i (i)}
      <path
        d={smoothPath(stroke, toScreen)}
        fill="none"
        stroke={color}
        stroke-width={a.width * vp.scale}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/each}
  {/if}
</g>
