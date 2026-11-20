<script lang="ts">
  import X from '@lucide/svelte/icons/x'
  import type { Theme, ToolbarPosition } from '../core/settings/preferences'
  import type { SettingsStore } from '../core/settings/settings.svelte'
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
</style>
