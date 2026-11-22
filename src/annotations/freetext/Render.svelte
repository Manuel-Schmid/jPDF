<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { FreeTextAnnotation } from '../../core/session/model'
  import { ASCENT, LINE_HEIGHT, lineX, TEXT_PADDING } from '../../core/geometry/textLayout'
  import { cssColor, FREETEXT_FONT, screenBox, turnTransform } from './screen'

  let { a, vp }: { a: FreeTextAnnotation; vp: PageViewport; selected: boolean } = $props()

  // Laid out in screen space, so the text reads upright on rotated pages like
  // the saved appearance (which counter-rotates its text frame).
  const box = $derived(screenBox(a.rect, vp))
  const s = $derived(vp.scale)
  const firstBaseline = $derived(box.top + (TEXT_PADDING + a.fontSize * ASCENT) * s)
  /** Width of the text area (pt): the box without the padding on both sides. */
  const inner = $derived(box.width / s - 2 * TEXT_PADDING)
</script>

<g transform={turnTransform(a.rect, a.rotation, vp)}>
  {#if a.background}
    <rect
      x={box.left}
      y={box.top}
      width={box.width}
      height={box.height}
      fill={cssColor(a.background.color)}
      fill-opacity={a.background.opacity}
    />
  {/if}
  {#each a.lines as line, i (i)}
    <text
      x={box.left + (TEXT_PADDING + lineX(line, a.fontSize, inner, a.align)) * s}
      y={firstBaseline + i * a.fontSize * LINE_HEIGHT * s}
      font-family={FREETEXT_FONT}
      font-size={a.fontSize * s}
      fill={cssColor(a.textColor)}
      xml:space="preserve">{line}</text
    >
  {/each}
</g>
