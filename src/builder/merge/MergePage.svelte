<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Plus from '@lucide/svelte/icons/plus'
  import GripVertical from '@lucide/svelte/icons/grip-vertical'
  import Merge from '@lucide/svelte/icons/merge'
  import X from '@lucide/svelte/icons/x'
  import { open as openDialog } from '@tauri-apps/plugin-dialog'
  import { onMount, tick, type Snippet } from 'svelte'
  import { flip } from 'svelte/animate'
  import { setDropTarget } from '../../app/fileOpening'
  import { saveSession } from '../../app/saveFlow'
  import { tabs } from '../../app/tabs.svelte'
  import { isAppError, mergePdfs } from '../../core/ipc/api'
  import { pickNewPdf } from '../pdfTarget'
  import { toasts } from '../../ui/toasts.svelte'
  import { THUMB_BOX, type MergeFiles } from './mergeFiles.svelte'
  import { blockers, dropIndex, mergedName, readyToMerge, totalPages } from './mergeList'

  let {
    files,
    heading,
    onclose,
    onmerged,
  }: {
    files: MergeFiles
    /** The header's title area (the builder's Pages | Merge switch, or a plain title). */
    heading: Snippet
    onclose: () => void
    /** Called with the merged file's path once it is written. */
    onmerged: (path: string) => void
  } = $props()

  const PDF_FILTER = [{ name: 'PDF', extensions: ['pdf'] }]

  const items = $derived(files.items)
  const total = $derived(totalPages(items))
  const ready = $derived(readyToMerge(items))
  let busy = $state(false)

  /** Why Merge is disabled, shown as its tooltip. */
  const hint = $derived(
    items.length < 2
      ? 'Add at least two PDFs'
      : items.some((i) => i.error)
        ? 'Remove the files that cannot be read'
        : items.some((i) => i.pages === null)
          ? 'Reading files…'
          : 'Merge into a new PDF',
  )

  async function addFiles() {
    const picked = await openDialog({ multiple: true, filters: PDF_FILTER })
    if (!picked) return
    files.add(Array.isArray(picked) ? picked : [picked])
  }

  async function merge() {
    if (!ready || busy) return
    const paths = items.map((i) => i.path)
    const unsaved = blockers(paths, (p) => tabs.findByPath(p)?.dirty ?? false)
    if (unsaved.length > 0) {
      const s = tabs.findByPath(unsaved[0])!
      toasts.show(`${s.fileName} has unsaved changes — save it before merging`, 'warning', {
        label: 'Save',
        run: () => void saveSession(s),
      })
      return
    }
    const target = await pickNewPdf(mergedName(paths[0]))
    if (!target) return
    busy = true
    try {
      await mergePdfs(paths, target)
    } catch (e) {
      console.error('Merging failed', e)
      toasts.show(isAppError(e) ? `Could not merge: ${e.message}` : 'Could not merge the files', 'error')
      return
    } finally {
      busy = false
    }
    onmerged(target)
  }

  // Dragging a row: it follows the pointer through the list, the others make room.
  let list = $state<HTMLOListElement>()
  let dragId = $state<number | null>(null)

  function startDrag(e: PointerEvent, id: number) {
    if (e.button !== 0 || (e.target as Element).closest('.remove')) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).focus()
    dragId = id
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDrag, { once: true })
    window.addEventListener('pointercancel', endDrag, { once: true })
  }

  function onDragMove(e: PointerEvent) {
    const from = items.findIndex((i) => i.id === dragId)
    if (from < 0) return endDrag()
    if (!list) return
    const rows = [...list.querySelectorAll<HTMLElement>('.row')]
    const mids = rows
      .filter((_, k) => k !== from)
      .map((r) => {
        const b = r.getBoundingClientRect()
        return b.top + b.height / 2
      })
    const to = dropIndex(e.clientY, mids)
    if (to !== from) files.move(from, to)
  }

  function endDrag() {
    dragId = null
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }

  /** Alt+↑/↓ moves the focused row, Delete removes it. */
  function onRowKeydown(e: KeyboardEvent, index: number) {
    const id = items[index].id
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      files.move(index, index + (e.key === 'ArrowUp' ? -1 : 1))
      // Moving the row's element in the list drops its focus.
      void tick().then(() => list?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus())
    } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const rows = list?.querySelectorAll<HTMLElement>('.row') ?? []
      rows[index + (e.key === 'ArrowUp' ? -1 : 1)]?.focus()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const rows = list?.querySelectorAll<HTMLElement>('.row') ?? []
      ;(rows[index + 1] ?? rows[index - 1])?.focus()
      files.remove(id)
    } else {
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  /** Shows the row's page-1 canvas (owned by MergeFiles; moved, not copied). */
  function thumbnail(node: HTMLElement, canvas: HTMLCanvasElement | null) {
    const show = (c: HTMLCanvasElement | null) => node.replaceChildren(...(c ? [c] : []))
    show(canvas)
    return { update: show }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || busy) return
    e.preventDefault()
    e.stopImmediatePropagation()
    onclose()
  }

  onMount(() => {
    const release = setDropTarget((paths) => files.add(paths))
    window.addEventListener('keydown', onKeydown, true)
    return () => {
      release()
      endDrag()
      window.removeEventListener('keydown', onKeydown, true)
    }
  })
</script>

<section class="merge" aria-label="Merge PDFs">
  <header>
    <button type="button" class="icon" aria-label="Back" title="Back (Esc)" onclick={() => onclose()}>
      <ArrowLeft size={18} />
    </button>
    {@render heading()}
  </header>

  <div class="scroller">
    {#if items.length === 0}
      <div class="empty">
        <p>Add the PDFs to merge, or drop them here.</p>
        <button type="button" class="primary" onclick={addFiles}><Plus size={16} /> Add PDFs…</button>
      </div>
    {:else}
      <ol class="list" role="listbox" aria-label="Files to merge, in order" bind:this={list} class:dragging={dragId !== null}>
        {#each items as item, i (item.id)}
          <li
            class="row"
            role="option"
            aria-selected="false"
            class:lifted={dragId === item.id}
            class:failed={item.error !== null}
            tabindex="0"
            aria-label="{i + 1}. {item.name}"
            animate:flip={{ duration: dragId === item.id ? 0 : 140 }}
            onpointerdown={(e) => startDrag(e, item.id)}
            onkeydown={(e) => onRowKeydown(e, i)}
            data-id={item.id}
          >
            <span class="grip" aria-hidden="true"><GripVertical size={16} /></span>
            <span class="index">{i + 1}</span>
            <span class="thumb" class:loading={item.pages === null && !item.error} style:--thumb="{THUMB_BOX}px" use:thumbnail={item.thumb}></span>
            <span class="text">
              <span class="name" title={item.path}>{item.name}</span>
              <span class="meta">
                {#if item.error}{item.error}{:else if item.pages === null}Reading…{:else}{item.pages} {item.pages === 1 ? 'page' : 'pages'}{/if}
              </span>
            </span>
            <button type="button" class="icon remove" aria-label="Remove {item.name}" title="Remove (Del)" onclick={() => files.remove(item.id)}>
              <X size={16} />
            </button>
          </li>
        {/each}
      </ol>
      <!-- Right where the next file goes. -->
      <button type="button" class="add-row" onclick={addFiles} disabled={busy}>
        <Plus size={16} /> Add PDFs…
      </button>
      <p class="tip">Drag to reorder · Alt+↑/↓ · drop more files anywhere</p>
    {/if}
  </div>

  <footer>
    <button type="button" class="action" onclick={addFiles} disabled={busy}>
      <Plus size={16} /> <span>Add PDFs…</span>
    </button>
    <span class="spacer"></span>
    {#if items.length > 0}
      <span class="total">{items.length} {items.length === 1 ? 'file' : 'files'} · {total} {total === 1 ? 'page' : 'pages'}</span>
    {/if}
    <button type="button" class="action primary" disabled={!ready || busy} title={hint} onclick={merge}>
      <Merge size={16} /> <span>{busy ? 'Merging…' : 'Merge…'}</span>
    </button>
  </footer>
</section>

<style>
  .merge {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .scroller {
    min-height: 0;
    overflow-y: auto;
    padding: 24px 16px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 640px;
    margin: 0 auto;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px 6px 4px;
    border-radius: var(--radius-md);
    background: var(--bg-deep);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: grab;
    transition: background var(--transition), box-shadow var(--transition);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .list.dragging .row {
    cursor: grabbing;
  }
  .row.lifted {
    position: relative;
    z-index: 1;
    background: var(--surface-hover);
    box-shadow: var(--page-shadow);
  }
  .grip {
    display: flex;
    color: var(--text-muted);
  }
  .index {
    min-width: 1.5em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--thumb);
    height: var(--thumb);
  }
  .thumb :global(canvas) {
    max-width: 100%;
    max-height: 100%;
    background: var(--page-bg);
    box-shadow: var(--page-shadow);
  }
  .thumb.loading {
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }
  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 2px;
  }
  .name {
    overflow: hidden;
    color: var(--text-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--text-muted);
    font-size: 12px;
  }
  .row.failed .meta {
    color: var(--danger);
  }
  .add-row {
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 640px;
    height: 44px;
    margin: 4px auto 0;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
  }
  .add-row:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text-strong);
  }
  .tip {
    margin: 12px auto 0;
    max-width: 640px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-top: 15vh;
    color: var(--text-muted);
  }
  .empty p {
    margin: 0;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-deep);
    border-top: 1px solid var(--border);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background var(--transition), color var(--transition), filter var(--transition);
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  .icon {
    justify-content: center;
    width: 32px;
    height: 28px;
  }
  .remove {
    color: var(--text-muted);
  }
  .action {
    height: 30px;
    padding: 0 10px;
  }
  .primary {
    height: 30px;
    padding: 0 14px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent);
    color: var(--on-accent);
    filter: brightness(1.1);
  }
  .primary:disabled {
    background: var(--surface-hover);
  }
  .spacer {
    flex: 1;
  }
  .total {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
