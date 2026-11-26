<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import type { SelectableBox } from '../../annotations/freetext/selectable'
  import { FREETEXT_FONT } from '../../annotations/freetext/screen'
  import { LINE_HEIGHT } from '../geometry/textLayout'
  import { registerTextLayer } from './textLayers'
  import { clientToPdf } from './viewerMath'

  /**
   * The text of a page's text boxes as selectable HTML text, for the text
   * markup tools (mounted only while one is active): transparent glyphs over
   * the SVG render, registered as a text layer (TextLayerPage.freeText), so
   * the text drag, native selection, unmarking and the quads of the markup
   * work on it as on the page's own text. Stacked above the overlay; only
   * the boxes take pointer input, so a press in a box marks its text (also
   * over page text) and one anywhere else goes on to the overlay as before.
   */
  let {
    page,
    vp,
    boxes,
    tint,
  }: {
    /** 0-based page index. */
    page: number
    vp: PageViewport
    boxes: readonly SelectableBox[]
    /** Colour of the native selection (CSS); undefined = the default selection colour. */
    tint?: string
  } = $props()

  let host: HTMLDivElement
  /**
   * The layout as a value: the boxes are rebuilt on every change of the page
   * (e.g. each frame of an underline preview), but the content is replaced
   * only when the layout really changes. Replacing it mid-drag would drop the
   * selection being dragged out.
   */
  const layout = $derived(JSON.stringify(boxes))

  $effect(() => {
    const v = vp
    return registerTextLayer(host, {
      page,
      toPdf: (x, y) => clientToPdf(x, y, host.getBoundingClientRect(), v),
      freeText: true,
    })
  })
</script>

<div bind:this={host} class="free-text-layer" class:tinted={tint} style:--selection-tint={tint}>
  <!-- Keyed: new content whenever the layout changes, so the text drag never uses a stale index of it. -->
  {#key layout}
    <div class="content">
      {#each boxes as b (b.id)}
        <div
          class="box"
          style:left="{b.left}px"
          style:top="{b.top}px"
          style:width="{b.width}px"
          style:height="{b.height}px"
          style:font-family={FREETEXT_FONT}
          style:font-size="{b.fontSize}px"
          style:font-weight={b.fontWeight}
          style:font-style={b.fontStyle}
          style:line-height={LINE_HEIGHT}
        >
          {#each b.lines as line, i (i)}
            <span style:left="{line.left - b.left}px" style:top="{line.top - b.top}px">{line.text}</span>
          {/each}
        </div>
      {/each}
    </div>
  {/key}
</div>

<style>
  .free-text-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .box {
    position: absolute;
    pointer-events: auto;
    cursor: text;
    user-select: none;
  }
  .box span {
    position: absolute;
    white-space: pre;
    color: transparent;
    user-select: text;
  }
  .box span::selection {
    background: color-mix(in srgb, AccentColor, transparent 50%);
    color: transparent;
  }
  .tinted .box span::selection {
    background: var(--selection-tint);
  }
</style>
