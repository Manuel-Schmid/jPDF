<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus'
  import X from '@lucide/svelte/icons/x'
  import { commands } from '../core/registry/commands'
  import { scrollToReveal, wheelToScroll } from './tabStrip'
  import { tabs } from './tabs.svelte'

  let strip: HTMLDivElement | undefined = $state()

  /** Scrolls the strip (without animation) so the active tab is fully visible. */
  function revealActive() {
    const tab = strip?.querySelector<HTMLElement>('.tab.active')
    if (!strip || !tab) return
    strip.scrollLeft = scrollToReveal(
      strip.scrollLeft,
      strip.clientWidth,
      tab.offsetLeft,
      tab.offsetWidth,
    )
  }

  // Only when the active tab changes or a tab is opened/closed, never per frame.
  $effect(() => {
    void tabs.activeId
    void tabs.sessions.length
    revealActive()
  })

  $effect(() => {
    const el = strip
    if (!el) return
    // Svelte's own wheel listeners are passive, so preventDefault needs this.
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToScroll(e.deltaX, e.deltaY, e.deltaMode)
      if (dx === 0 || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += dx
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    // Resizing the window changes the strip's width: keep the active tab in view.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealActive)
    observer?.observe(el)
    return () => {
      el.removeEventListener('wheel', onWheel)
      observer?.disconnect()
    }
  })
</script>

<div class="tabs">
  <div class="strip" role="tablist" bind:this={strip}>
    {#each tabs.sessions as s (s.id)}
      <div
        class="tab"
        class:active={s.id === tabs.activeId}
        role="tab"
        tabindex="0"
        aria-selected={s.id === tabs.activeId}
        title={s.path}
        onclick={() => (tabs.activeId = s.id)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') tabs.activeId = s.id
        }}
        onauxclick={(e) => {
          if (e.button === 1) void tabs.close(s.id)
        }}
      >
        <span class="name">{s.fileName}</span>
        <button
          type="button"
          class="close"
          aria-label="Close {s.fileName}"
          onclick={(e) => {
            e.stopPropagation()
            void tabs.close(s.id)
          }}
        >
          {#if s.dirty}
            <span class="dot">•</span>
            <span class="x"><X size={14} /></span>
          {:else}
            <span class="x always"><X size={14} /></span>
          {/if}
        </button>
      </div>
    {/each}
  </div>
  <button
    type="button"
    class="add"
    aria-label="Open PDF"
    onclick={() => void commands.execute('file.open')}
  >
    <Plus size={16} />
  </button>
</div>

<style>
  /* Tabs shrink first, like a browser; below their minimum width the strip
     scrolls instead of drawing over the search box and window controls. */
  .tabs {
    display: flex;
    align-items: stretch;
    flex: 0 1 auto;
    height: 100%;
    min-width: 0;
  }
  .strip {
    position: relative; /* offsetParent for the tabs' offsetLeft */
    display: flex;
    align-items: stretch;
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 200px;
    min-width: 96px;
    padding: 0 8px 0 12px;
    color: var(--text);
    cursor: default;
    transition: background var(--transition);
  }
  .tab:hover {
    background: var(--surface-hover);
  }
  .tab.active {
    background: var(--surface);
    color: var(--text-strong);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close,
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    color: inherit;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .close {
    flex: none;
    width: 20px;
    height: 20px;
    padding: 0;
  }
  .close:hover,
  .add:hover {
    background: var(--surface-hover);
  }
  .x {
    display: none;
  }
  .x.always {
    display: flex;
    visibility: hidden;
  }
  .tab:hover .x,
  .close:focus-visible .x {
    display: flex;
    visibility: visible;
  }
  .tab:hover .dot,
  .close:focus-visible .dot {
    display: none;
  }
  .add {
    flex: none;
    align-self: center;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    color: var(--text);
  }
</style>
