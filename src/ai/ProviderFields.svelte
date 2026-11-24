<script lang="ts">
  import { describeAiError } from './errors'
  import { aiHasKey, aiSetKey, aiTest } from './ipc'
  import { PROVIDER_PRESETS, presetById, type ProviderPreset } from './presets'

  // One provider's settings (main or backup): preset, base URL, model and the
  // API key, which goes to the Windows Credential Manager under the preset's
  // id. The key is looked up only while these fields are shown.
  let {
    idPrefix,
    label,
    provider,
    baseUrl,
    model,
    exclude = null,
    allowNone = false,
    onprovider,
    onbaseurl,
    onmodel,
  }: {
    /** Prefix for the element ids (unique per instance). */
    idPrefix: string
    /** Label of the provider list, e.g. "Provider" or "Backup provider". */
    label: string
    /** Preset id, or 'none' (only with allowNone). */
    provider: string
    baseUrl: string
    model: string
    /** A preset that may not be chosen here (the main provider, for the backup). */
    exclude?: string | null
    /** Offers "None" first. */
    allowNone?: boolean
    /** A preset was chosen: its id and the preset (null for "None"). */
    onprovider(id: string, preset: ProviderPreset | null): void
    onbaseurl(url: string): void
    onmodel(model: string): void
  } = $props()

  const preset = $derived(presetById(provider))
  const options = $derived(PROVIDER_PRESETS.filter((p) => p.id !== exclude || p.id === provider))
  const active = $derived(provider !== 'none' && !!preset)

  /** Whether the provider has a stored key (null: checking). */
  let hasKey = $state<boolean | null>(null)
  let keyDraft = $state('')
  let busy = $state(false)
  let status = $state<{ ok: boolean; text: string } | null>(null)

  $effect(() => {
    if (!active) return
    const id = provider
    hasKey = null
    let stale = false
    aiHasKey(id)
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

  function choose(id: string) {
    status = null
    keyDraft = ''
    onprovider(id, presetById(id) ?? null)
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
      await aiSetKey(provider, keyDraft)
      keyDraft = ''
      hasKey = await aiHasKey(provider)
      return hasKey ? 'Key saved in the Windows Credential Manager.' : 'Key removed.'
    })

  const removeKey = () =>
    task(async () => {
      await aiSetKey(provider, '')
      hasKey = false
      return 'Key removed.'
    })

  const testKey = () =>
    task(async () => {
      await aiTest({ provider, baseUrl, model })
      return 'The key works.'
    })
</script>

<div class="grid">
  <label for="{idPrefix}-provider">{label}</label>
  <select id="{idPrefix}-provider" value={provider} onchange={(e) => choose(e.currentTarget.value)}>
    {#if allowNone}<option value="none">None</option>{/if}
    {#each options as p (p.id)}
      <option value={p.id}>{p.name}{p.free ? ' (free key available)' : ''}</option>
    {/each}
  </select>
  {#if active}
    <label for="{idPrefix}-url">Base URL</label>
    <input
      id="{idPrefix}-url"
      type="url"
      placeholder="https://…/v1"
      value={baseUrl}
      onchange={(e) => onbaseurl(e.currentTarget.value.trim())}
    />
    <label for="{idPrefix}-model">Model</label>
    <input id="{idPrefix}-model" type="text" value={model} onchange={(e) => onmodel(e.currentTarget.value.trim())} />
    <label for="{idPrefix}-key">API key</label>
    <div class="key">
      <input
        id="{idPrefix}-key"
        type="password"
        autocomplete="off"
        placeholder={hasKey ? '•••••••• (stored)' : 'Paste your API key'}
        bind:value={keyDraft}
      />
      <button type="button" class="button" disabled={busy || keyDraft.trim() === ''} onclick={saveKey}>Save</button>
    </div>
  {/if}
</div>
{#if active}
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
  .grid {
    display: grid;
    grid-template-columns: 96px 1fr;
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
  .hint {
    color: var(--text-muted);
    font-size: 12px;
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
