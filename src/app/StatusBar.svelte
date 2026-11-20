<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Maximize from '@lucide/svelte/icons/maximize'
  import Minus from '@lucide/svelte/icons/minus'
  import Plus from '@lucide/svelte/icons/plus'
  import Redo2 from '@lucide/svelte/icons/redo-2'
  import Settings from '@lucide/svelte/icons/settings'
  import Undo2 from '@lucide/svelte/icons/undo-2'
  import { commands } from '../core/registry/commands'
  import type { DocumentSession } from '../core/session/session.svelte'
  import { parsePageInput, parseZoomInput } from '../core/viewer/viewerMath'

  let {
    session = null,
    builderOpen = false,
    ontogglebuilder,
  }: {
    session?: DocumentSession | null
    /** Whether the Document Builder is shown (its button looks pressed). */
    builderOpen?: boolean
    ontogglebuilder?: () => void
  } = $props()

  const numPages = $derived(session?.pageSizes.length ?? 0)
  const zoomPct = $derived(session ? Math.round(session.scale * 100) : 100)

  let pageEditing = $state(false)
  let pageDraft = $state('')
  let zoomEditing = $state(false)
  let zoomDraft = $state('')

  function onPageKeydown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement
    if (e.key === 'Enter') {
      const page = parsePageInput(pageDraft, numPages)
      if (page !== null) session?.goToPage(page)
    } else if (e.key !== 'Escape') return
    // Leaving edit mode shows session.currentPage again (reverting invalid input).
    pageEditing = false
    input.blur()
  }

  function onZoomKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const scale = parseZoomInput(zoomDraft)
      if (scale !== null) session?.zoomTo(scale)
    } else if (e.key !== 'Escape') return
    zoomEditing = false
  }

  function startZoomEdit() {
    zoomDraft = String(zoomPct)
    zoomEditing = true
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
</script>

<footer class="statusbar">
  <div class="left">
    <button type="button" aria-label="Settings" title="Settings" onclick={() => commands.execute('app.settings')}>
      <Settings size={16} />
    </button>
    <span class="divider"></span>
    <button
      type="button"
      aria-label="Undo"
      disabled={!session?.history.canUndo}
      onclick={() => commands.execute('edit.undo')}
    >
      <Undo2 size={16} />
    </button>
    <button
      type="button"
      aria-label="Redo"
      disabled={!session?.history.canRedo}
      onclick={() => commands.execute('edit.redo')}
    >
      <Redo2 size={16} />
    </button>
  </div>
  <div class="center" data-region="page-nav">
    <button
      type="button"
      aria-label="Previous page"
      disabled={!session || session.currentPage <= 1}
      onclick={() => session?.goToPage(session.currentPage - 1)}
    >
      <ChevronLeft size={16} />
    </button>
    <input
      class="page-input"
      type="text"
      inputmode="numeric"
      aria-label="Page number"
      disabled={!session}
      value={pageEditing ? pageDraft : session ? String(session.currentPage) : ''}
      onfocus={(e) => {
        pageDraft = String(session?.currentPage ?? '')
        pageEditing = true
        e.currentTarget.select()
      }}
      oninput={(e) => (pageDraft = e.currentTarget.value)}
      onkeydown={onPageKeydown}
      onblur={() => (pageEditing = false)}
    />
    <span class="count">/ {numPages}</span>
    <button
      type="button"
      aria-label="Next page"
      disabled={!session || session.currentPage >= numPages}
      onclick={() => session?.goToPage(session.currentPage + 1)}
    >
      <ChevronRight size={16} />
    </button>
  </div>
  <div class="right">
    <button
      type="button"
      class:pressed={builderOpen}
      aria-label="Document Builder"
      aria-pressed={builderOpen}
      title="Document Builder"
      disabled={!session}
      onclick={() => ontogglebuilder?.()}
    >
      <LayoutGrid size={16} />
    </button>
    <span class="divider"></span>
    <div class="zoom" data-region="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!session}
        onclick={() => commands.execute('view.zoomOut')}
      >
        <Minus size={16} />
      </button>
      {#if zoomEditing && session}
        <input
          class="zoom-input"
          type="text"
          inputmode="decimal"
          aria-label="Zoom percentage"
          value={zoomDraft}
          oninput={(e) => (zoomDraft = e.currentTarget.value)}
          onkeydown={onZoomKeydown}
          onblur={() => (zoomEditing = false)}
          {@attach focusAndSelect}
        />
      {:else}
        <button
          type="button"
          class="zoom-level"
          aria-label="Zoom level {zoomPct}%"
          disabled={!session}
          onclick={startZoomEdit}
        >
          {zoomPct}%
        </button>
      {/if}
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!session}
        onclick={() => commands.execute('view.zoomIn')}
      >
        <Plus size={16} />
      </button>
    </div>
    <button type="button" aria-label="Fullscreen" onclick={() => commands.execute('view.fullscreen')}>
      <Maximize size={16} />
    </button>
  </div>
</footer>

<style>
  .statusbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 100%;
    padding: 0 8px;
    background: var(--bg-deep);
    border-top: 1px solid var(--border);
  }
  .left,
  .right,
  .center,
  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .right {
    justify-content: flex-end;
  }
  .count {
    min-width: 40px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background var(--transition);
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  button.pressed {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .divider {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--border);
  }
  .zoom-level,
  .zoom-input {
    width: 56px;
    font-variant-numeric: tabular-nums;
  }
  input {
    height: 22px;
    padding: 0 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    font: inherit;
    text-align: center;
    font-variant-numeric: tabular-nums;
    outline: none;
    transition: border-color var(--transition);
  }
  input:focus {
    border-color: var(--accent);
  }
  input:disabled {
    color: var(--text-muted);
  }
  .page-input {
    width: 44px;
  }
</style>
