<script lang="ts">
  import { shortcutSections } from '../core/registry/shortcuts'
  import { toolAvailable, toolRegistry, type ToolRegistry } from '../core/registry/tools'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import ShortcutRow from './ShortcutRow.svelte'

  /**
   * Settings → Shortcuts: every keyboard shortcut, from the shortcut catalog.
   * The tool letters are those of the current toolbar (a tool's letter does
   * nothing without it on the toolbar). Loaded on first visit only.
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

  const sections = $derived(shortcutSections(tools))
</script>

<p class="intro">Press <kbd>?</kbd> or <kbd>F1</kbd> anywhere to open this list.</p>

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
      <ShortcutRow {row} />
    {/each}
  </section>
{/each}

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
  kbd {
    padding: 0 5px;
    border: 1px solid var(--scrollbar-thumb);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
  }
</style>
