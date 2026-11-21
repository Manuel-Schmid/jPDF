<script lang="ts">
  import X from '@lucide/svelte/icons/x'
  import type { ReopenAt, Theme, ToolbarPosition } from '../core/settings/preferences'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import { TOOL_PRESETS, matchesPreset, type ToolPreset } from '../core/settings/toolPresets'
  import { toasts } from './toasts.svelte'
  import Modal from './Modal.svelte'
  import Segmented from './Segmented.svelte'

  // App-wide preferences. Each change applies at once and is saved by the
  // store (debounced); there is no OK/Cancel.
  let { store, onclose }: { store: SettingsStore; onclose(): void } = $props()

  const themes: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'Follow Windows' },
  ]

  const toolbarPositions: { value: ToolbarPosition; label: string }[] = [
    { value: 'right', label: 'Right' },
    { value: 'left', label: 'Left' },
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
  ]

  const reopenOptions: { value: ReopenAt; label: string }[] = [
    { value: 'last', label: 'Where I left off' },
    { value: 'start', label: 'First page' },
  ]

  /** The preset the toolbar is exactly (unchanged since it was applied), if any. */
  const current = $derived(TOOL_PRESETS.find((p) => matchesPreset(store.data.toolbar, p))?.id)

  // Replaces the toolbar at once; the toast's Undo puts the old one back, so
  // a customised toolbar is never lost to a stray click.
  function apply(preset: ToolPreset) {
    if (preset.id === current) return
    const previous = store.applyPreset(preset)
    toasts.show(`Toolbar set to “${preset.name}”`, 'info', {
      label: 'Undo',
      run: () => store.restoreToolbar(previous),
    })
  }
</script>

<Modal label="Settings" {onclose}>
  <div class="settings">
    <header>
      <h2>Settings</h2>
      <button type="button" class="close" aria-label="Close" title="Close" onclick={onclose}>
        <X size={16} />
      </button>
    </header>
    <section>
      <span class="label">Theme</span>
      <Segmented
        label="Theme"
        options={themes}
        value={store.data.preferences.theme}
        onchange={(v) => store.setPreference('theme', v)}
      />
    </section>
    <section>
      <span class="label">Toolbar position</span>
      <Segmented
        label="Toolbar position"
        options={toolbarPositions}
        value={store.data.preferences.toolbarPosition}
        onchange={(v) => store.setPreference('toolbarPosition', v)}
      />
    </section>
    <section>
      <span class="label">Reopen files</span>
      <Segmented
        label="Reopen files"
        options={reopenOptions}
        value={store.data.preferences.reopenAt}
        onchange={(v) => store.setPreference('reopenAt', v)}
      />
    </section>
    <section>
      <span class="label" id="presets-label">Tool preset</span>
      <span class="hint">Replaces the toolbar with a ready-made set of tools.</span>
      <div class="presets" role="group" aria-labelledby="presets-label">
        {#each TOOL_PRESETS as p (p.id)}
          <button type="button" class="preset" aria-pressed={p.id === current} onclick={() => apply(p)}>
            <span class="name">{p.name}</span>
            <span class="description">{p.description}</span>
            <span class="count">{p.toolbar.length} tools</span>
          </button>
        {/each}
      </div>
    </section>
  </div>
</Modal>

<style>
  .settings {
    width: 380px;
    max-width: 100%;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px -4px 16px 0;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    transition: background var(--transition);
  }
  .close:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  section {
    display: grid;
    gap: 8px;
  }
  section + section {
    margin-top: 16px;
  }
  .label {
    color: var(--text-strong);
  }
  .hint {
    margin-top: -4px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .presets {
    display: grid;
    gap: 4px;
  }
  .preset {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .preset:hover {
    background: var(--surface-hover);
  }
  .preset[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .name {
    color: var(--text-strong);
  }
  .description {
    grid-column: 1;
    color: var(--text);
    font-size: 12px;
  }
  .count {
    grid-column: 2;
    grid-row: 1 / span 2;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }
</style>
