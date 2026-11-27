<script lang="ts">
  import { withShortcut } from '../core/registry/shortcuts'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import { actionIcons } from '../ui/actionIcons'
  import { onMount } from 'svelte'
  import { firstOccurrences } from '../core/session/pages'
  import type { DocumentSession } from '../core/session/session.svelte'
  import { toasts } from '../ui/toasts.svelte'
  import BuilderTabs, { type BuilderView } from './BuilderTabs.svelte'
  import ExportMenu from './export/ExportMenu.svelte'
  import MergePage from './merge/MergePage.svelte'
  import { MergeFiles } from './merge/mergeFiles.svelte'
  import PageThumb from './PageThumb.svelte'
  import {
    clampSelection, clickPage, emptySelection, selectAll, selectOnly, sortedSelection, type PageSelection,
  } from './selection'

  let {
    session,
    onclose,
    onmerged,
  }: {
    session: DocumentSession
    /** Leaves the builder; `page` (1-based) is the page to show in the viewer, if any. */
    onclose: (page?: number) => void
    /** A merge wrote `path`, or an exported copy is to be opened (the caller opens it). */
    onmerged: (path: string) => void
  } = $props()

  let view = $state<BuilderView>('pages')
  /** The Export menu is showing: Escape closes it, not the builder. */
  let exportOpen = $state(false)
  /** The merge list, created on first use and kept while switching views (the open document comes first). */
  let mergeFiles = $state.raw<MergeFiles | null>(null)
  function showView(v: BuilderView) {
    if (v === 'merge') mergeFiles ??= new MergeFiles([session.path])
    view = v
  }
  onMount(() => () => mergeFiles?.dispose())

  const MIN_SIZE = 96
  const MAX_SIZE = 320
  const SIZE_KEY = 'juliepdf.builder.thumbSize'

  function savedSize(): number {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY))
      if (v >= MIN_SIZE && v <= MAX_SIZE) return v
    } catch {
      // Storage unavailable: default size.
    }
    return 160
  }

  /** Tile size while dragging the slider (CSS only) and the size thumbnails are rendered for. */
  const initialSize = savedSize()
  let size = $state(initialSize)
  let renderSize = $state(initialSize)

  function commitSize(v: number) {
    renderSize = v
    try {
      localStorage.setItem(SIZE_KEY, String(v))
    } catch {
      // Not remembered; harmless.
    }
  }

  let sel = $state.raw<PageSelection>(emptySelection)
  const count = $derived(session.pages.length)
  const firsts = $derived(firstOccurrences(session.pages))
  const selectedCount = $derived(sel.selected.size)
  const canDelete = $derived(selectedCount > 0 && selectedCount < count)

  // Undo/redo may shorten the list under the selection.
  $effect(() => {
    const next = clampSelection(sel, count)
    if (next !== sel) sel = next
  })

  let scroller: HTMLDivElement

  /** One observer for all tiles: those within a screen of the viewport get pixels. */
  let observer: IntersectionObserver | null = null
  const watchers = new Map<Element, (visible: boolean) => void>()
  function observe(el: Element, cb: (visible: boolean) => void): () => void {
    watchers.set(el, cb)
    observer?.observe(el)
    return () => {
      watchers.delete(el)
      observer?.unobserve(el)
    }
  }

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) watchers.get(e.target)?.(e.isIntersecting)
      },
      { root: scroller, rootMargin: '100% 0px' },
    )
    for (const el of watchers.keys()) observer.observe(el)
    // Start where the viewer was.
    const current = scroller.querySelectorAll('.tile')[session.currentPage - 1]
    current?.scrollIntoView({ block: 'center' })
    return () => observer?.disconnect()
  })

  function onselect(i: number, e: MouseEvent) {
    sel = clickPage(sel, i, e.shiftKey)
  }

  function fail(what: string, e: unknown) {
    console.error(`Could not ${what} the pages`, e)
    toasts.show(`Could not ${what} the pages`, 'error')
  }

  async function rotate(delta: 90 | -90) {
    if (selectedCount === 0) return
    try {
      await session.rotatePages(sortedSelection(sel), delta)
    } catch (e) {
      fail('rotate', e)
    }
  }

  function duplicate() {
    if (selectedCount === 0) return
    try {
      sel = selectOnly(session.duplicatePages(sortedSelection(sel)))
    } catch (e) {
      fail('duplicate', e)
    }
  }

  function remove() {
    if (selectedCount === 0) return
    if (!canDelete) {
      toasts.show('A document needs at least one page', 'warning')
      return
    }
    try {
      if (session.deletePages(sortedSelection(sel))) sel = emptySelection
    } catch (e) {
      fail('delete', e)
    }
  }

  function toggleAll() {
    sel = selectedCount === count ? emptySelection : selectAll(count)
  }

  /** Builder keys; they win over the global bindings while the builder is open (undo/redo still pass). */
  function onKeydown(e: KeyboardEvent) {
    // The merge view handles its own keys; an open menu handles Escape and arrows.
    if (view !== 'pages' || exportOpen) return
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const ctrl = e.ctrlKey || e.metaKey
    let handled = true
    if (e.key === 'Escape') {
      if (selectedCount > 0) sel = emptySelection
      else onclose()
    } else if (typing) {
      handled = false
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'a') {
      sel = selectAll(count)
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'd') {
      duplicate()
    } else if (!ctrl && (e.key === 'Delete' || e.key === 'Backspace')) {
      remove()
    } else {
      handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  })
</script>

{#snippet heading()}
  <h1>Document Builder</h1>
  <BuilderTabs {view} onchange={showView} />
  {#if view === 'pages'}
    <span class="file">{session.fileName} · {count} {count === 1 ? 'page' : 'pages'}</span>
  {/if}
{/snippet}

{#if view === 'merge' && mergeFiles}
  <MergePage files={mergeFiles} {heading} onclose={() => onclose()} {onmerged} />
{/if}
<!-- Hidden, not unmounted, while merging: its thumbnails' observer keeps its scroller. -->
<section class="builder" aria-label="Document Builder" hidden={view !== 'pages'}>
  <header>
    <button type="button" class="icon" aria-label="Back to document" title="Back (Esc)" onclick={() => onclose()}>
      <ArrowLeft size={18} />
    </button>
    {@render heading()}
    <span class="spacer"></span>
    <ExportMenu {session} onopen={onmerged} bind:open={exportOpen} />
  </header>

  <div class="scroller" bind:this={scroller}>
    <div class="grid" style:--tile="{size + 24}px">
      {#each session.pages as entry, i (i)}
        <PageThumb
          {session}
          index={i}
          {entry}
          first={firsts[i]}
          {size}
          {renderSize}
          selected={sel.selected.has(i)}
          {observe}
          {onselect}
          onopen={(i) => onclose(i + 1)}
        />
      {/each}
    </div>
  </div>

  <footer>
    <button type="button" class="action count" onclick={toggleAll} title={withShortcut('Select all / none', 'builder.selectAll')}>
      {selectedCount === 0 ? 'Select all' : `${selectedCount} selected`}
    </button>
    <span class="sep"></span>
    <button type="button" class="action" disabled={selectedCount === 0} onclick={() => rotate(-90)} title="Rotate left">
      <actionIcons.rotateLeft size={16} /> <span>Rotate left</span>
    </button>
    <button type="button" class="action" disabled={selectedCount === 0} onclick={() => rotate(90)} title="Rotate right">
      <actionIcons.rotateRight size={16} /> <span>Rotate right</span>
    </button>
    <button type="button" class="action" disabled={selectedCount === 0} onclick={duplicate} title={withShortcut('Duplicate', 'builder.duplicate')}>
      <actionIcons.duplicate size={16} /> <span>Duplicate</span>
    </button>
    <button type="button" class="action danger" disabled={!canDelete} onclick={remove} title="Delete (Del)">
      <actionIcons.delete size={16} /> <span>Delete</span>
    </button>
    <span class="spacer"></span>
    <input
      class="size"
      type="range"
      min={MIN_SIZE}
      max={MAX_SIZE}
      step="8"
      value={size}
      aria-label="Thumbnail size"
      oninput={(e) => (size = Number(e.currentTarget.value))}
      onchange={(e) => commitSize(Number(e.currentTarget.value))}
    />
  </footer>
</section>

<style>
  .builder {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    user-select: none;
  }
  .builder[hidden] {
    display: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .file {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scroller {
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: 4px;
    justify-items: center;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 4px;
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
    transition: background var(--transition), color var(--transition);
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  button:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
  .icon {
    justify-content: center;
    width: 32px;
    height: 28px;
  }
  .action {
    height: 30px;
    padding: 0 10px;
  }
  .count {
    min-width: 96px;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
  .danger:not(:disabled) {
    color: var(--danger);
  }
  .danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--border);
  }
  .spacer {
    flex: 1;
  }
  .size {
    width: 140px;
    accent-color: var(--accent);
  }
</style>
