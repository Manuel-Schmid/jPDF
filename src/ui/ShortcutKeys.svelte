<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import X from '@lucide/svelte/icons/x'
  import { tick } from 'svelte'
  import { chordFromEvent } from '../core/registry/keybindings'
  import {
    addChord,
    chordLabel,
    clashesWith,
    keyCaps,
    keyProblem,
    removeChord,
    resetShortcut,
    type ShortcutEntry,
    type ShortcutOverrides,
    type ShortcutRow,
  } from '../core/registry/shortcuts'

  /**
   * The editable key area of a shortcut row: its keys (each removable), a
   * button that records a new key, and a reset button once it differs from
   * the default. A key another command uses asks first whether to take it
   * over. Every change goes out through `onchange` as the new overrides.
   */
  let {
    row,
    overrides,
    toolKeys,
    onchange,
  }: {
    row: ShortcutRow
    overrides: ShortcutOverrides
    /** The tools' letters (and Shift + letter) → tool name: not assignable. */
    toolKeys: ReadonlyMap<string, string>
    onchange(next: ShortcutOverrides): void
  } = $props()

  let recording = $state(false)
  /** Why the last recorded key was refused. */
  let problem = $state<string | null>(null)
  /** A recorded key that other commands use, waiting for Replace or Cancel. */
  let clash = $state<{ chord: string; with: ShortcutEntry[] } | null>(null)
  let addButton = $state<HTMLButtonElement>()
  let recorder = $state<HTMLButtonElement>()

  const changed = $derived(Object.hasOwn(overrides, row.id))
  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'])

  async function start() {
    problem = null
    clash = null
    recording = true
    await tick()
    recorder?.focus()
  }

  async function stop() {
    recording = false
    await tick()
    addButton?.focus()
  }

  function take(chord: string) {
    const refused = keyProblem(chord, toolKeys, row.id)
    if (refused) {
      problem = refused
      return
    }
    if (row.chords.includes(chord)) return
    const others = clashesWith(overrides, chord, row.id)
    if (others.length > 0) clash = { chord, with: others }
    else onchange(addChord(overrides, row.id, chord, []))
  }

  // While recording, the next key belongs to the recorder: the app's
  // shortcuts, the dialog's Escape and focus moves never see it.
  $effect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (MODIFIER_KEYS.has(e.key)) return // wait for the key itself
      const chord = chordFromEvent(e)
      void stop()
      if (chord !== 'Escape') take(chord)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  function replace() {
    if (!clash) return
    onchange(addChord(overrides, row.id, clash.chord, clash.with.map((e) => e.id)))
    clash = null
  }

  const names = (entries: ShortcutEntry[]) => entries.map((e) => `“${e.label}”`).join(' and ')
</script>

<div class="editor">
  <div class="keys">
    {#each row.chords as chord (chord)}
      <span class="chip">
        <span class="chord">{#each keyCaps(chord) as cap, j (j)}<kbd>{cap}</kbd>{/each}</span>
        <button
          type="button"
          class="icon remove"
          aria-label="Remove {chordLabel(chord)} from {row.label}"
          title="Remove {chordLabel(chord)}"
          onclick={() => onchange(removeChord(overrides, row.id, chord))}
        >
          <X size={12} />
        </button>
      </span>
    {/each}
    {#if recording}
      <button type="button" class="record" bind:this={recorder} onblur={() => (recording = false)}>
        Press a key… (Esc cancels)
      </button>
    {:else}
      <button
        type="button"
        class="icon add"
        bind:this={addButton}
        aria-label="Add a key to {row.label}"
        title="Add a key"
        onclick={start}
      >
        <Plus size={14} />
      </button>
    {/if}
    {#if changed}
      <button
        type="button"
        class="icon"
        aria-label="Reset {row.label} to its default keys"
        title="Reset to default"
        onclick={() => onchange(resetShortcut(overrides, row.id))}
      >
        <RotateCcw size={14} />
      </button>
    {/if}
  </div>
  {#if clash}
    <div class="message" role="alert">
      <span>{chordLabel(clash.chord)} is used by {names(clash.with)}.</span>
      <button type="button" class="text" onclick={replace}>Replace</button>
      <button type="button" class="text" onclick={() => (clash = null)}>Cancel</button>
    </div>
  {:else if problem}
    <div class="message" role="status">{problem}</div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }
  /* One outlined pill per key combination, its × inside: clearly which one it removes. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 2px 2px 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .chord {
    display: inline-flex;
    gap: 3px;
  }
  kbd {
    min-width: 1.9em;
    padding: 1px 6px;
    border: 1px solid var(--scrollbar-thumb);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
    font-size: var(--font-size-dialog-hint);
    line-height: 1.5;
    text-align: center;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    transition: background var(--transition), color var(--transition);
  }
  .icon:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .remove {
    width: 18px;
    height: 18px;
  }
  .record {
    padding: 2px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text-strong);
    font-size: var(--font-size-dialog-hint);
  }
  .message {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    max-width: 360px;
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    text-align: right;
  }
  .text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-size-dialog-hint);
  }
  .text:hover {
    text-decoration: underline;
  }
</style>
