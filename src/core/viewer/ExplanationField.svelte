<script lang="ts" module>
  /** AI for the field (only while AI features are on): regenerating this page's explanation. */
  export interface FieldAi {
    /** A generation of this document is running: this page's own ('this'), another one ('other'), or none (null). */
    running: 'this' | 'other' | null
    /** Regenerates this page's explanation, following `instruction` when given. */
    regenerate(instruction: string | null): void
    cancel(): void
  }

  /** The quick instructions of the Regenerate menu: label, and what the model is asked. */
  export const QUICK_INSTRUCTIONS: readonly { label: string; instruction: string }[] = [
    { label: 'Simpler', instruction: 'Make it simpler and easier to understand.' },
    { label: 'More detail', instruction: 'Go into more detail.' },
    { label: 'Add an example', instruction: 'Add a short concrete example.' },
    { label: 'Shorter', instruction: 'Make it shorter.' },
  ]
</script>

<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import PencilLine from '@lucide/svelte/icons/pencil-line'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import ContextMenu, { type MenuItem } from '../../ui/ContextMenu.svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import X from '@lucide/svelte/icons/x'
  import type { Explanation } from '../session/model'
  import type { DocumentSession } from '../session/session.svelte'
  import { FIELD_BODY, FIELD_HEADER, NOTE_HEIGHT, type FieldState } from './explanationLayout'

  // The explanation field under a page (or the "no text" note), positioned
  // by the Viewer at a fixed height that the page layout reserves. Typing
  // stays local; the text is committed as one undo step when the field loses
  // focus, or when save/close commits pending edits.
  let {
    session,
    index,
    mode,
    explanation,
    top,
    left,
    width,
    ai = null,
  }: {
    session: DocumentSession
    /** 0-based page index. */
    index: number
    mode: Exclude<FieldState, 'none'>
    explanation: Explanation | null
    top: number
    left: number
    width: number
    ai?: FieldAi | null
  } = $props()

  /** The Regenerate menu, open at the button. */
  let menu = $state<{ x: number; y: number; anchor: HTMLElement } | null>(null)
  /** Typing a custom instruction (Custom…): the header shows an input instead. */
  let asking = $state(false)
  let instruction = $state('')
  let askInput = $state<HTMLInputElement>()

  function onRegenerateClick(e: MouseEvent) {
    if (!ai) return
    if (ai.running === 'this') return ai.cancel()
    const b = e.currentTarget as HTMLElement
    const r = b.getBoundingClientRect()
    menu = menu ? null : { x: r.left, y: r.bottom, anchor: b }
  }

  function regenerate(text: string | null) {
    // What is being typed is kept first (it is what "the current explanation" means).
    commit()
    ai?.regenerate(text)
  }

  const menuItems = (): MenuItem[] => [
    { label: 'Regenerate', icon: RotateCw, run: () => regenerate(null) },
    ...QUICK_INSTRUCTIONS.map((q, k) => ({ label: q.label, separatorBefore: k === 0, run: () => regenerate(q.instruction) })),
    {
      label: 'Custom…',
      icon: PencilLine,
      separatorBefore: true,
      run: async () => {
        instruction = ''
        asking = true
        await tick()
        askInput?.focus()
      },
    },
  ]

  function onAskKeydown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Escape') asking = false
    if (e.key === 'Enter' && instruction.trim()) {
      asking = false
      regenerate(instruction)
    }
  }

  /** Text being typed (null: not editing, show the explanation's text). */
  let draft = $state<string | null>(null)
  const text = $derived(draft ?? explanation?.text ?? '')
  const label = $derived(`Explanation of page ${index + 1}`)

  function commit() {
    const value = draft
    draft = null
    if (session.pendingEdit === commit) session.pendingEdit = null
    if (value !== null) session.editExplanation(index, value)
  }

  // Scrolled out of view (unmounted) while typing: keep what was typed.
  onDestroy(() => {
    if (draft !== null) commit()
  })

  function onfocus() {
    // Another open edit (a text box) is finished first; this one is pending now.
    session.commitPendingEdit()
    session.pendingEdit = commit
  }

  function onkeydown(e: KeyboardEvent) {
    // Undo/redo inside the text belong to the field, not to the document.
    if (e.ctrlKey && ['z', 'y'].includes(e.key.toLowerCase())) e.stopPropagation()
    if (e.key === 'Escape') {
      e.stopPropagation()
      ;(e.currentTarget as HTMLTextAreaElement).blur()
    }
  }
</script>

{#if mode === 'note'}
  <div class="note" style:top="{top}px" style:left="{left}px" style:width="{width}px" style:height="{NOTE_HEIGHT}px">
    No text on this page: nothing to explain (scanned pages have no text).
  </div>
{:else}
  <section
    class="field"
    aria-label={label}
    style:top="{top}px"
    style:left="{left}px"
    style:width="{width}px"
    style:height="{mode === 'open' ? FIELD_HEADER + FIELD_BODY : FIELD_HEADER}px"
  >
    <header style:height="{FIELD_HEADER}px">
      {#if asking}
        <input
          bind:this={askInput}
          class="ask"
          aria-label="How should the explanation change?"
          placeholder="How should it change? (Enter to regenerate, Esc to cancel)"
          bind:value={instruction}
          onkeydown={onAskKeydown}
          onblur={() => (asking = false)}
        />
      {:else}
      <button
        type="button"
        class="toggle"
        aria-expanded={mode === 'open'}
        aria-label={mode === 'open' ? 'Collapse explanation' : 'Expand explanation'}
        onclick={() => session.toggleExplanation(index)}
      >
        {#if mode === 'open'}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
        <span class="title">Explanation</span>
      </button>
      {#if mode === 'collapsed'}
        <span class="preview">{text}</span>
      {:else if explanation?.model}
        <span class="model" title="Generated by {explanation.model}">{explanation.model}</span>
      {/if}
      {/if}
      {#if ai}
        <button
          type="button"
          class="regenerate"
          aria-label={ai.running === 'this' ? 'Stop regenerating' : 'Regenerate explanation'}
          aria-haspopup={ai.running === 'this' ? undefined : 'menu'}
          title={ai.running === 'this' ? 'Regenerating… Click to stop.' : ai.running ? 'Explanations are being generated' : 'Regenerate explanation'}
          disabled={ai.running === 'other'}
          onclick={onRegenerateClick}
        >
          {#if ai.running === 'this'}<LoaderCircle size={14} class="spin" />{:else}<RotateCw size={14} />{/if}
        </button>
      {/if}
      <button type="button" class="remove" aria-label="Remove explanation" title="Remove explanation" onclick={() => session.removeExplanation(index)}>
        <X size={14} />
      </button>
    </header>
    {#if mode === 'open'}
      <textarea
        aria-label={label}
        placeholder="Write what this page says…"
        spellcheck="true"
        style:height="{FIELD_BODY}px"
        value={text}
        oninput={(e) => (draft = e.currentTarget.value)}
        {onfocus}
        onblur={commit}
        {onkeydown}
      ></textarea>
    {/if}
  </section>
  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} anchor={menu.anchor} items={menuItems()} onclose={() => (menu = null)} />
  {/if}
{/if}

<style>
  .field,
  .note {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-strong);
    overflow: hidden;
  }
  .note {
    display: flex;
    align-items: center;
    padding: 0 10px;
    color: var(--text);
    font-style: italic;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    border-bottom: 1px solid var(--border);
  }
  button {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 4px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .title {
    font-weight: 600;
  }
  .preview,
  .model {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .model {
    font-size: 11px;
    color: var(--text-muted);
  }
  .remove {
    margin-left: auto;
  }
  /* With the regenerate button, that one takes the free space: both sit at the right. */
  .regenerate {
    margin-left: auto;
  }
  .regenerate + .remove {
    margin-left: 0;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:disabled:hover {
    background: transparent;
    color: var(--text);
  }
  .ask {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    font: inherit;
    outline: none;
  }
  textarea {
    box-sizing: border-box;
    display: block;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    resize: none;
    background: transparent;
    border: 0;
    color: var(--text-strong);
    font: inherit;
    line-height: 1.45;
    outline: none;
  }
  textarea:focus {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
