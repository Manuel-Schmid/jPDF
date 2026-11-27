<script lang="ts">
  import { SHORTCUTS, chordsIn, keyCaps, shortcutSections, type ShortcutOverrides } from '../core/registry/shortcuts'
  import { toolAvailable, toolRegistry, type ToolRegistry } from '../core/registry/tools'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import ShortcutKeys from './ShortcutKeys.svelte'
  import ShortcutRow from './ShortcutRow.svelte'
  import { toasts } from './toasts.svelte'

  /**
   * Settings → Shortcuts: every keyboard shortcut, from the shortcut catalog,
   * each changeable (record, remove, reset) except tool letters and the
   * fixed ones. The tool letters are those of the current toolbar (a tool's
   * letter does nothing without it on the toolbar). Loaded on first visit only.
   */
  let { store, registry = toolRegistry }: { store: SettingsStore; registry?: ToolRegistry } = $props()

  const tools = $derived.by(() => {
    const seen = new Set<string>()
    return store.data.toolbar.flatMap((instance) => {
      if (seen.has(instance.type)) return []
      seen.add(instance.type)
      const def = registry.list().find((d) => d.type === instance.type)
      if (!def?.shortcut || !toolAvailable(def, store.data.preferences)) return []
      return [{ type: def.type, displayName: def.displayName, shortcut: def.shortcut }]
    })
  })

  const overrides = $derived(store.data.preferences.shortcutOverrides)
  const sections = $derived(shortcutSections(tools, overrides))
  /** The keys that open this list, as the Keyboard shortcuts row shows them (the user's, if changed). */
  const openKeys = $derived(chordsIn(overrides, 'app.shortcuts'))
  const editable = new Set(SHORTCUTS.filter((s) => !s.fixed).map((s) => s.id))

  /** Every tool's letter and Shift + letter (bound whether or not it is on the toolbar). */
  const toolKeys = $derived(
    new Map(
      registry.list().flatMap((d) => {
        if (!d.shortcut) return []
        const letter = d.shortcut.toUpperCase()
        return [
          [letter, d.displayName],
          [`Shift+${letter}`, d.displayName],
        ] as [string, string][]
      }),
    ),
  )

  function save(next: ShortcutOverrides) {
    store.setPreference('shortcutOverrides', next as Record<string, string[]>)
  }

  // Like resetting a palette: the toast's Undo brings the user's keys back.
  function resetAll() {
    const previous = overrides
    save({})
    toasts.show('Shortcuts reset', 'info', { label: 'Undo', run: () => save(previous) })
  }
</script>

<p class="intro">
  {#if openKeys.length > 0}
    Press
    {#each openKeys as chord, i (chord)}{#if i > 0}&nbsp;or{/if}
      {#each keyCaps(chord) as cap, j (j)}<kbd>{cap}</kbd>{/each}
    {/each}
    anywhere to open this list.
  {/if}
  Use + to add a key to a command, × to remove one.
</p>

{#each sections as section (section.group)}
  <section aria-labelledby="shortcuts-{section.group}">
    <h4 id="shortcuts-{section.group}">{section.label}</h4>
    {#if section.group === 'tools'}
      <p class="note">
        A tool's key picks it on the toolbar; with several of a kind, pressing it again picks the next one and
        <kbd>Shift</kbd> + the key the previous one.
      </p>
    {/if}
    {#each section.rows as row (row.id)}
      {#if editable.has(row.id)}
        <ShortcutRow {row}>
          {#snippet keys(r)}
            <ShortcutKeys row={r} {overrides} {toolKeys} onchange={save} />
          {/snippet}
        </ShortcutRow>
      {:else}
        <ShortcutRow {row} />
      {/if}
    {/each}
  </section>
{/each}

<div class="footer">
  <button type="button" class="button" disabled={Object.keys(overrides).length === 0} onclick={resetAll}>
    Reset all shortcuts
  </button>
</div>

<style>
  .intro {
    margin: 0;
    padding: 16px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
  }
  section {
    padding-top: 18px;
  }
  h4 {
    margin: 0 0 4px;
    color: var(--text-strong);
    font-size: var(--font-size-dialog);
    font-weight: 600;
  }
  .note {
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.4;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 20px;
  }
  .button {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
    cursor: pointer;
  }
  .button:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .button:disabled {
    background: transparent;
    color: var(--text-disabled);
    cursor: default;
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--scrollbar-thumb);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
  }
</style>
