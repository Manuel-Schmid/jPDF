<script lang="ts">
  import type { PageViewport } from 'pdfjs-dist'
  import { actionIcons } from '../../ui/actionIcons'
  import { BAR_GAP, BAR_H, barAbove } from './cardPlacement'
  import type { Rect } from '../session/model'

  // The one action for an area a lasso left around page content (see
  // AreaSelection): explain it. Placed like the selection bar, above the
  // area (below it when there is no room above).
  let { rect, vp, onexplain }: { rect: Rect; vp: PageViewport; onexplain(): void } = $props()

  /** Approximate bar width (px), to keep it on the page. */
  const BAR_W = 170

  const above = $derived(barAbove(rect))
  const top = $derived(above ? rect[1] - BAR_H - BAR_GAP : Math.min(rect[3] + BAR_GAP, vp.height - BAR_H))
  const left = $derived(Math.max(0, Math.min(rect[0], vp.width - BAR_W)))
  const Icon = actionIcons.generateExplanation
</script>

<!-- A sibling of the overlay, like the selection bar: its presses never reach the tool. -->
<div
  class="area-bar"
  data-page-ui
  role="toolbar"
  aria-label="Area actions"
  tabindex="-1"
  style:left="{left}px"
  style:top="{top}px"
  onpointerdown={(e) => e.stopPropagation()}
>
  <button
    type="button"
    title="Explain this area with AI (added to the page's explanation)"
    onclick={(e) => {
      e.stopPropagation()
      onexplain()
    }}
  >
    <Icon size={16} />
    <span>Explain this area</span>
  </button>
</div>

<style>
  .area-bar {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 4px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    font: var(--font-size-base) var(--font-ui);
    color: var(--text);
    white-space: nowrap;
    user-select: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font: inherit;
    cursor: pointer;
    transition: background var(--transition);
  }
  button:hover {
    background: var(--surface-hover);
  }
</style>
