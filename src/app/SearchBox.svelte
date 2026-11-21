<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import type { FindState } from './find.svelte'

  let { find }: { find: FindState } = $props()

  let input = $state<HTMLInputElement | null>(null)

  // Ctrl+F (again): focus the field and select its text.
  $effect(() => {
    void find.focusRequests
    if (find.open && input) {
      input.focus()
      input.select()
    }
  })

  const count = $derived.by(() => {
    if (find.query.trim() === '') return ''
    const n = find.hits.length
    if (n > 0) return `${find.index + 1} / ${n}`
    return find.searching ? '…' : '0 / 0'
  })
  const none = $derived(count === '0 / 0')

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Consumed here: Esc in the field only closes the search.
      e.preventDefault()
      e.stopPropagation()
      find.close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) find.previous()
      else find.next()
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && 'azyxcv'.includes(e.key.toLowerCase())) {
      // Text editing in the field, not the document's undo / select all / clipboard.
      e.stopPropagation()
    }
  }
</script>

{#if find.open}
  <div class="search" role="search">
    <Search size={14} />
    <input
      bind:this={input}
      type="text"
      placeholder="Find"
      aria-label="Find in document"
      spellcheck="false"
      autocomplete="off"
      value={find.query}
      oninput={(e) => (find.query = e.currentTarget.value)}
      {onkeydown}
    />
    <span class="count" class:none aria-live="polite">{count}</span>
    <button
      type="button"
      aria-label="Previous match"
      title="Previous match (Shift+Enter)"
      disabled={find.hits.length === 0}
      onclick={() => find.previous()}
    >
      <ChevronUp size={14} />
    </button>
    <button
      type="button"
      aria-label="Next match"
      title="Next match (Enter)"
      disabled={find.hits.length === 0}
      onclick={() => find.next()}
    >
      <ChevronDown size={14} />
    </button>
    <button type="button" aria-label="Close search" title="Close (Esc)" onclick={() => find.close()}>
      <X size={14} />
    </button>
  </div>
{:else}
  <button type="button" class="toggle" aria-label="Find" title="Find (Ctrl+F)" onclick={() => find.show()}>
    <Search size={16} />
  </button>
{/if}

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    margin: 0 8px;
    padding: 0 2px 0 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  input {
    width: 150px;
    min-width: 0;
    margin-left: 4px;
    background: none;
    border: 0;
    outline: none;
    color: var(--text-strong);
    font: inherit;
  }
  .count {
    min-width: 44px;
    padding: 0 4px;
    text-align: right;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .count.none {
    color: var(--danger);
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .toggle {
    width: 28px;
    height: 28px;
    margin: 0 8px;
    color: var(--text);
  }
</style>
