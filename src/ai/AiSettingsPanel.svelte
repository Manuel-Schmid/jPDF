<script lang="ts">
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import { aiConfigOf } from './config'
  import { describeAiError } from './errors'
  import { aiHasKey, aiSetKey, aiTest } from './ipc'
  import { PROVIDER_PRESETS, presetById } from './presets'

  // Settings → AI (Beta): off by default. Turning it on shows what is sent
  // where; the API key goes to the Windows Credential Manager, never into the
  // settings file. The key is only looked up while this panel is open.
  let { store }: { store: SettingsStore } = $props()

  const prefs = $derived(store.data.preferences)
  const preset = $derived(presetById(prefs.aiProvider))

  const onOff: { value: 'on' | 'off'; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]

  /** Whether the provider has a stored key (null: checking). */
  let hasKey = $state<boolean | null>(null)
  let keyDraft = $state('')
  let busy = $state(false)
  let status = $state<{ ok: boolean; text: string } | null>(null)

  $effect(() => {
    if (!prefs.aiEnabled) return
    const provider = prefs.aiProvider
    hasKey = null
    let stale = false
    aiHasKey(provider)
      .then((v) => {
        if (!stale) hasKey = v
      })
      .catch((e: unknown) => {
        if (stale) return
        hasKey = false
        status = { ok: false, text: describeAiError(e) }
      })
    return () => (stale = true)
  })

  function choosePreset(id: string) {
    const p = presetById(id)
    status = null
    keyDraft = ''
    store.setPreference('aiProvider', id)
    // Custom keeps whatever URL and model were set.
    if (p && p.id !== 'custom') {
      store.setPreference('aiBaseUrl', p.baseUrl)
      store.setPreference('aiModel', p.model)
    }
  }

  async function task(run: () => Promise<string>) {
    busy = true
    status = null
    try {
      status = { ok: true, text: await run() }
    } catch (e) {
      status = { ok: false, text: describeAiError(e) }
    } finally {
      busy = false
    }
  }

  const saveKey = () =>
    task(async () => {
      await aiSetKey(prefs.aiProvider, keyDraft)
      keyDraft = ''
      hasKey = await aiHasKey(prefs.aiProvider)
      return hasKey ? 'Key saved in the Windows Credential Manager.' : 'Key removed.'
    })

  const removeKey = () =>
    task(async () => {
      await aiSetKey(prefs.aiProvider, '')
      hasKey = false
      return 'Key removed.'
    })

  const testKey = () =>
    task(async () => {
      await aiTest(aiConfigOf(prefs))
      return 'The key works.'
    })
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
    “Add explanations” sends the document's text to the provider below. Free tiers may use it to train their
    models. Nothing is sent before you click.
  </p>
  <div class="grid">
    <label for="ai-provider">Provider</label>
    <select id="ai-provider" value={prefs.aiProvider} onchange={(e) => choosePreset(e.currentTarget.value)}>
      {#each PROVIDER_PRESETS as p (p.id)}
        <option value={p.id}>{p.name}{p.free ? ' (free key available)' : ''}</option>
      {/each}
    </select>
    <label for="ai-url">Base URL</label>
    <input
      id="ai-url"
      type="url"
      placeholder="https://…/v1"
      value={prefs.aiBaseUrl}
      onchange={(e) => store.setPreference('aiBaseUrl', e.currentTarget.value.trim())}
    />
    <label for="ai-model">Model</label>
    <input
      id="ai-model"
      type="text"
      value={prefs.aiModel}
      onchange={(e) => store.setPreference('aiModel', e.currentTarget.value.trim())}
    />
    <label for="ai-key">API key</label>
    <div class="key">
      <input
        id="ai-key"
        type="password"
        autocomplete="off"
        placeholder={hasKey ? '•••••••• (stored)' : 'Paste your API key'}
        bind:value={keyDraft}
      />
      <button type="button" class="button" disabled={busy || keyDraft.trim() === ''} onclick={saveKey}>Save</button>
    </div>
  </div>
  <p class="hint key-status">
    {#if hasKey === null}Looking for a stored key…{:else if hasKey}A key is stored in the Windows Credential Manager.{:else}No key stored for this provider.{/if}
    {#if preset?.keyUrl}Get one at <span class="url">{preset.keyUrl}</span>.{/if}
  </p>
  <div class="actions">
    <button type="button" class="button" disabled={busy || !hasKey} onclick={testKey}>Test</button>
    <button type="button" class="button" disabled={busy || !hasKey} onclick={removeKey}>Remove key</button>
    {#if status}<span class="status" class:error={!status.ok} role="status">{status.text}</span>{/if}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
  }
  .text {
    display: grid;
    gap: 2px;
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
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px 12px;
  }
  label {
    color: var(--text);
  }
  .key {
    display: flex;
    gap: 6px;
  }
  .key input {
    flex: 1;
    min-width: 0;
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .key-status {
    margin: 10px 0;
  }
  .url {
    color: var(--text-strong);
    user-select: all;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .button:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  .status {
    color: var(--success);
    font-size: 12px;
  }
  .status.error {
    color: var(--danger);
  }
</style>
