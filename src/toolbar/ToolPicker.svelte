<script lang="ts">
  import type { ToolRegistry } from '../core/registry/tools'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import Modal from '../ui/Modal.svelte'

  // "+" picker: one card per tool type that can be added. A single-instance
  // tool already in the toolbar is left out (adding it would only switch to
  // it); once removed, it is offered again.
  let {
    registry,
    store,
    onpick,
    onclose,
  }: {
    registry: ToolRegistry
    store: SettingsStore
    onpick(type: string): void
    onclose(): void
  } = $props()

  const registered = $derived(registry.list())
  const tools = $derived(
    registered.filter((def) => def.allowMultipleInstances || !store.data.toolbar.some((i) => i.type === def.type)),
  )
</script>

<Modal label="Add tool" {onclose}>
  <h2>Add a tool</h2>
  <div class="grid">
    {#each tools as def (def.type)}
      <button type="button" class="card" onclick={() => onpick(def.type)}>
        <span class="icon"><def.Icon settings={def.defaultSettings} size={24} /></span>
        <span class="name">{def.displayName}</span>
        <span class="desc">{def.description}</span>
      </button>
    {:else}
      <p class="empty">{registered.length ? 'All tools are already in the toolbar.' : 'No tools available.'}</p>
    {/each}
  </div>
</Modal>

<style>
  h2 {
    margin: 0 0 16px;
    font-family: var(--font-logo);
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 10px;
    width: min(560px, calc(100vw - 88px));
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .card:hover,
  .card:focus-visible {
    background: var(--surface-hover);
    border-color: var(--accent);
    outline: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 4px;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-strong);
  }
  .name {
    color: var(--text-strong);
    font-weight: 600;
  }
  .desc {
    font-size: 12px;
    line-height: 1.4;
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
  }
</style>
