<script lang="ts">
  import type { ToolDefinition } from '../core/registry/tools'
  import type { ToolInstance } from '../core/settings/settings.svelte'
  import type { Side } from './placement'

  let {
    def,
    instance,
    active,
    dragOffset = null,
    side = 'left',
    onclick,
    oncontextmenu,
    onpointerdown,
    onpointermove,
    onpointerup,
    onpointercancel,
  }: {
    def: ToolDefinition
    instance: ToolInstance
    active: boolean
    /** Drag offset (px) along the toolbar's axis while this button is being dragged. */
    dragOffset?: number | null
    /** The strip edge facing the page area: the active marker sits there; left/right means a vertical strip. */
    side?: Side
    onclick(e: MouseEvent): void
    oncontextmenu(e: MouseEvent): void
    onpointerdown(e: PointerEvent): void
    onpointermove(e: PointerEvent): void
    onpointerup(e: PointerEvent): void
    onpointercancel(e: PointerEvent): void
  } = $props()

  const title = $derived(def.shortcut ? `${def.displayName} (${def.shortcut.toUpperCase()})` : def.displayName)
</script>

<button
  type="button"
  class="tool"
  class:active
  class:dragging={dragOffset !== null}
  style:transform={dragOffset !== null ? `translate${side === 'left' || side === 'right' ? 'Y' : 'X'}(${dragOffset}px)` : undefined}
  data-side={side}
  data-instance={instance.instanceId}
  aria-label={def.displayName}
  aria-pressed={active}
  {title}
  {onclick}
  {oncontextmenu}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
>
  <def.Icon settings={instance.settings} size={20} />
</button>

<style>
  .tool {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    touch-action: none;
    transition: background var(--transition), color var(--transition);
  }
  .tool:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .tool.active {
    background: var(--accent-soft);
    color: var(--text-strong);
  }
  /* 2px accent bar at the strip edge facing the page, left by default (button sits 6px in). */
  .tool::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    opacity: 0;
    transform: scaleY(0.4);
    transition: opacity var(--transition), transform var(--transition);
  }
  .tool[data-side='right']::before {
    left: auto;
    right: -6px;
  }
  /* Horizontal strip: the bar runs along the bottom (top toolbar) or top edge. */
  .tool[data-side='bottom']::before,
  .tool[data-side='top']::before {
    top: auto;
    bottom: auto;
    left: 10px;
    right: 10px;
    width: auto;
    height: 2px;
    transform: scaleX(0.4);
  }
  .tool[data-side='bottom']::before {
    bottom: -6px;
  }
  .tool[data-side='top']::before {
    top: -6px;
  }
  .tool.active::before {
    opacity: 1;
    transform: none;
  }
  .tool.dragging {
    z-index: 1;
    background: var(--surface);
    box-shadow: var(--shadow-soft);
    cursor: grabbing;
    transition: none;
  }
  .tool.dragging::before {
    opacity: 0;
  }
</style>
