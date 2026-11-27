<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import FileDown from '@lucide/svelte/icons/file-down'
  import ContextMenu, { type MenuItem } from '../../ui/ContextMenu.svelte'
  import type { DocumentSession } from '../../core/session/session.svelte'
  import { exportCleanCopy } from './exportFlow'

  let {
    session,
    onopen,
    open = $bindable(false),
  }: {
    session: DocumentSession
    /** Opens an exported copy (the toast's Open action). */
    onopen: (path: string) => void
    /** Whether the menu is showing (the builder leaves Escape to it then). */
    open?: boolean
  } = $props()

  let button = $state<HTMLButtonElement>()
  let busy = $state(false)
  let at = $state({ x: 0, y: 0 })

  /** Runs one export, the button disabled meanwhile. */
  async function run(exporter: (s: DocumentSession, open: (path: string) => void) => Promise<boolean>) {
    busy = true
    try {
      await exporter(session, onopen)
    } finally {
      busy = false
    }
  }

  // The export variants; further ones (selected pages, flattened…) go here.
  const items: MenuItem[] = [{ label: 'Without annotations…', run: () => void run(exportCleanCopy) }]

  function toggle() {
    if (open || !button) {
      open = false
      return
    }
    const r = button.getBoundingClientRect()
    // Right-aligned under the button (the menu opens leftwards from x when there is no room).
    at = { x: r.right, y: r.bottom + 4 }
    open = true
  }
</script>

<button
  type="button"
  class="export"
  bind:this={button}
  disabled={busy}
  aria-haspopup="menu"
  aria-expanded={open}
  title="Export a copy of this document"
  onclick={toggle}
>
  <FileDown size={16} /> <span>{busy ? 'Exporting…' : 'Export'}</span> <ChevronDown size={14} />
</button>
{#if open}
  <ContextMenu x={at.x} y={at.y} {items} anchor={button} onclose={() => (open = false)} />
{/if}

<style>
  .export {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px 0 10px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .export:hover:not(:disabled),
  .export[aria-expanded='true'] {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .export:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
