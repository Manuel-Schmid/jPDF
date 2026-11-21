<script lang="ts">
  import FileText from '@lucide/svelte/icons/file-text'
  import X from '@lucide/svelte/icons/x'
  import { fileNameOf } from '../core/session/session.svelte'
  import { folderOf, openedLabel, type RecentFile } from '../core/settings/recentFiles'
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte'
  import Logo from './Logo.svelte'

  let {
    onOpen,
    onMerge,
    recent = [],
    onOpenRecent,
    onRemoveRecent,
  }: {
    onOpen: () => void
    onMerge?: () => void
    /** Recently opened files, most recent first; listed below the buttons. */
    recent?: RecentFile[]
    onOpenRecent?: (path: string) => void
    onRemoveRecent?: (path: string) => void
  } = $props()

  /** Read once: the labels only need to be right when the start page is shown. */
  const now = Date.now()

  /** The right-click menu of a recent file. */
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null)

  function onContextMenu(e: MouseEvent, path: string) {
    e.preventDefault()
    if (!onRemoveRecent) return
    const remove = onRemoveRecent
    menu = { x: e.clientX, y: e.clientY, items: [{ label: 'Remove from list', icon: X, run: () => remove(path) }] }
  }
</script>

<div class="empty">
  <Logo size="lg" full />
  <button type="button" class="open" onclick={() => onOpen()}>Open PDF</button>
  <p class="hint">or drop a file here · Ctrl+O</p>
  {#if onMerge}
    <button type="button" class="link" onclick={() => onMerge()}>Merge PDFs…</button>
  {/if}
  {#if recent.length > 0 && onOpenRecent}
    <section class="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent files</h2>
      <ul>
        {#each recent as f (f.path)}
          <li class="row">
            <button
              type="button"
              class="file"
              title={f.path}
              onclick={() => onOpenRecent(f.path)}
              oncontextmenu={(e) => onContextMenu(e, f.path)}
            >
              <FileText size={16} />
              <span class="name">{fileNameOf(f.path)}</span>
              <span class="folder">{folderOf(f.path)}</span>
              <span class="date">{openedLabel(f.openedAt, now)}</span>
            </button>
            {#if onRemoveRecent}
              <button
                type="button"
                class="remove"
                aria-label={`Remove ${fileNameOf(f.path)} from list`}
                title="Remove from list"
                onclick={() => onRemoveRecent(f.path)}
              >
                <X size={14} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 24px 16px;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .open {
    background: var(--accent);
    color: var(--on-accent);
    border: 0;
    border-radius: var(--radius-md);
    padding: 10px 28px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: filter var(--transition);
  }
  .open:hover {
    filter: brightness(1.1);
  }
  .link {
    background: transparent;
    border: 0;
    padding: 4px 8px;
    color: var(--text);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color var(--transition);
  }
  .link:hover {
    color: var(--text-strong);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
  }
  .recent {
    width: 520px;
    max-width: 100%;
    margin-top: 8px;
  }
  h2 {
    margin: 0 0 6px 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    position: relative;
    display: flex;
  }
  .file {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 6px 36px 6px 10px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition);
  }
  .file:hover,
  .file:focus-visible {
    background: var(--surface-hover);
  }
  .name {
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }
  .folder {
    min-width: 0;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .date {
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .remove {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition), background var(--transition);
  }
  .row:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  .remove:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
</style>
