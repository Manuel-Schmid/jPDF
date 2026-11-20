<script lang="ts">
  import type { Snippet } from 'svelte'
  import { flyoutPosition, type Side } from '../toolbar/placement'
  import { dismissable } from './dismissable'

  // Panel opening next to `anchor` toward `side` (left by default), kept inside
  // the window. Closes on Escape and outside pointer-down (the anchor itself
  // excluded, so its own click handler can toggle).
  let {
    anchor,
    side = 'left',
    label,
    title,
    actions,
    onclose,
    children,
  }: {
    anchor: HTMLElement
    /** The side of the anchor it opens on (toward the page area). */
    side?: Side
    /** Accessible name of the dialog. */
    label: string
    /** Visible heading. */
    title?: string
    /** Controls at the top right, next to the heading (e.g. the tool lock). */
    actions?: Snippet
    onclose(): void
    children: Snippet
  } = $props()

  /** Where the open animation starts from: a few px back toward the anchor. */
  const SLIDE: Record<Side, string> = { left: '6px, 0', right: '-6px, 0', top: '0, 6px', bottom: '0, -6px' }

  let el: HTMLDivElement
  let top = $state(0)
  let left = $state(0)

  function place() {
    const p = flyoutPosition(anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, side)
    left = p.left
    top = p.top
  }

  $effect(() => {
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    ro?.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
    }
  })
</script>

<div
  class="flyout"
  role="dialog"
  aria-label={label}
  data-side={side}
  bind:this={el}
  style:top="{top}px"
  style:left="{left}px"
  style:--slide="translate({SLIDE[side]})"
  use:dismissable={{ onclose, ignore: [anchor] }}
>
  {#if title || actions}
    <header>
      {#if title}<h2>{title}</h2>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</div>

<style>
  .flyout {
    position: fixed;
    z-index: 20;
    width: 256px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    animation: in 140ms ease-out;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Room for the actions without growing the header past the heading's line. */
    min-height: 16px;
    margin: -4px 0;
  }
  .actions {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: var(--slide);
    }
  }
</style>
