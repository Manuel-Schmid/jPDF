<script lang="ts">
  import type { Snippet } from 'svelte'
  import { keyCaps, type ShortcutRow } from '../core/registry/shortcuts'

  /**
   * One shortcut: what it does (and when) on the left, its keys on the right.
   * `keys` replaces the key area; customizing (#169) puts its "record a key"
   * control and reset button there, so the row layout stays as it is.
   */
  let { row, keys }: { row: ShortcutRow; keys?: Snippet<[ShortcutRow]> } = $props()
</script>

<div class="shortcut">
  <div class="what">
    <span class="label">{row.label}</span>
    {#if row.context}<span class="context">{row.context}</span>{/if}
  </div>
  <div class="keys">
    {#if keys}
      {@render keys(row)}
    {:else}
      {#each row.chords as chord, i (chord)}
        {#if i > 0}<span class="or">or</span>{/if}
        <span class="chord">
          {#each keyCaps(chord) as cap, j (j)}<kbd>{cap}</kbd>{/each}
        </span>
      {/each}
    {/if}
  </div>
</div>

<style>
  .shortcut {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 8px 0;
  }
  /* Rows are the only divs in their section: a line between them, none above the first. */
  .shortcut:not(:first-of-type) {
    border-top: 1px solid var(--separator);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    color: var(--text-strong);
  }
  .context {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .chord {
    display: inline-flex;
    gap: 3px;
  }
  .or {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
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
</style>
