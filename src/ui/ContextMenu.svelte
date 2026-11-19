<script lang="ts" module>
  import type { Component } from 'svelte'

  export interface MenuItem {
    label: string
    icon?: Component<{ size?: number }>
    danger?: boolean
    /** Shown greyed out; cannot be chosen and arrow keys skip it. */
    disabled?: boolean
    /** A divider line above this item (starts a new group). */
    separatorBefore?: boolean
    run(): void
  }
</script>

<script lang="ts">
  import { dismissable } from './dismissable'

  // Menu at a pointer position (kept inside the window). Choosing an item, Escape
  // or a pointer-down outside closes it. Arrow keys move between items.
  let { x, y, items, onclose }: { x: number; y: number; items: MenuItem[]; onclose(): void } = $props()

  const MARGIN = 8
  const ENABLED = '[role="menuitem"]:not(:disabled)'

  let el: HTMLDivElement
  let left = $state(0)
  let top = $state(0)

  $effect(() => {
    // Open leftwards when there is no room on the right (the tool strip sits at the right edge).
    const w = el.offsetWidth
    left = Math.max(MARGIN, x + w + MARGIN > window.innerWidth ? x - w : x)
    top = Math.max(MARGIN, Math.min(y, window.innerHeight - el.offsetHeight - MARGIN))
    el.querySelector<HTMLElement>(ENABLED)?.focus()
  })

  function choose(item: MenuItem) {
    if (item.disabled) return
    onclose()
    item.run()
  }

  function onKeydown(e: KeyboardEvent) {
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const all = [...el.querySelectorAll<HTMLElement>(ENABLED)]
    const i = all.indexOf(document.activeElement as HTMLElement)
    all[(i + delta + all.length) % all.length]?.focus()
  }
</script>

<div
  class="menu"
  role="menu"
  tabindex="-1"
  bind:this={el}
  style:left="{left}px"
  style:top="{top}px"
  onkeydown={onKeydown}
  oncontextmenu={(e) => e.preventDefault()}
  use:dismissable={{ onclose }}
>
  {#each items as item (item.label)}
    {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
    <button type="button" role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => choose(item)}>
      {#if item.icon}<item.icon size={14} />{/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 25;
    min-width: 160px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    animation: in 120ms ease-out;
  }
  .menu:focus {
    outline: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--surface-hover);
    color: var(--text-strong);
    outline: none;
  }
  .separator {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  .danger:hover,
  .danger:focus-visible {
    color: var(--danger);
  }
  button:disabled,
  button:disabled:hover {
    color: var(--text-muted);
    background: transparent;
    cursor: default;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
</style>
