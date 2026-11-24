<script lang="ts">
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import type { ProviderPreset } from './presets'
  import ProviderFields from './ProviderFields.svelte'

  // Settings → AI (Beta): off by default. Turning it on shows what is sent
  // where. A backup provider (optional) takes the remaining pages when the
  // main one is busy or out of quota. Keys go to the Windows Credential
  // Manager, never into the settings file.
  let { store }: { store: SettingsStore } = $props()

  const prefs = $derived(store.data.preferences)

  const onOff: { value: 'on' | 'off'; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]

  /** Whether a chosen preset fills in its base URL and model (Custom and None keep what was set). */
  const fills = (preset: ProviderPreset | null): preset is ProviderPreset => !!preset && preset.id !== 'custom'

  function chooseMain(id: string, preset: ProviderPreset | null) {
    store.setPreference('aiProvider', id)
    if (fills(preset)) {
      store.setPreference('aiBaseUrl', preset.baseUrl)
      store.setPreference('aiModel', preset.model)
    }
    // The backup must be another provider (its own key, its own outage).
    if (prefs.aiBackupProvider === id) store.setPreference('aiBackupProvider', 'none')
  }

  function chooseBackup(id: string, preset: ProviderPreset | null) {
    store.setPreference('aiBackupProvider', id)
    if (fills(preset)) {
      store.setPreference('aiBackupBaseUrl', preset.baseUrl)
      store.setPreference('aiBackupModel', preset.model)
    }
  }
</script>

<div class="row">
  <div class="text">
    <span class="label">Page explanations <span class="beta">Beta</span></span>
    <span class="hint">A few sentences under each page, generated when you ask.</span>
  </div>
  <Segmented
    label="Page explanations"
    options={onOff}
    value={prefs.aiEnabled ? 'on' : 'off'}
    onchange={(v) => store.setPreference('aiEnabled', v === 'on')}
  />
</div>

{#if prefs.aiEnabled}
  <p class="note" role="note">
    “Add explanations” sends the document's text to the provider below (and to the backup, if it steps in).
    Free tiers may use it to train their models. Nothing is sent before you click.
  </p>
  <ProviderFields
    idPrefix="ai"
    label="Provider"
    provider={prefs.aiProvider}
    baseUrl={prefs.aiBaseUrl}
    model={prefs.aiModel}
    onprovider={chooseMain}
    onbaseurl={(v) => store.setPreference('aiBaseUrl', v)}
    onmodel={(v) => store.setPreference('aiModel', v)}
  />
  <div class="section">
    <span class="label">Backup provider</span>
    <span class="hint">Takes the remaining pages when the main provider is busy or out of free quota.</span>
  </div>
  <ProviderFields
    idPrefix="ai-backup"
    label="Backup"
    provider={prefs.aiBackupProvider}
    baseUrl={prefs.aiBackupBaseUrl}
    model={prefs.aiBackupModel}
    exclude={prefs.aiProvider}
    allowNone
    onprovider={chooseBackup}
    onbaseurl={(v) => store.setPreference('aiBackupBaseUrl', v)}
    onmodel={(v) => store.setPreference('aiBackupModel', v)}
  />
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
  }
  .text,
  .section {
    display: grid;
    gap: 2px;
  }
  .section {
    margin: 20px 0 10px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .label {
    color: var(--text-strong);
  }
  .hint {
    color: var(--text-muted);
    font-size: 12px;
  }
  .beta {
    margin-left: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
  }
  .note {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text-strong);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
