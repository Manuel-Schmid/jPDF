<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import { lookupInfo, lookupModels } from './cliCache'
  import { cliConfigOf } from './config'
  import type { CliInfo, CliKind, CliModel } from './cliIpc'
  import { FALLBACK, effortsFor, groupModels, picturesFor, withStored } from './modelOptions'
  import { parseAnswerLine } from './parse'
  import { SYSTEM_PROMPT, userPrompt } from './prompt'

  // Settings → AI (Beta): off by default. Turning it on shows which CLI runs
  // the explanations, whether it was found, its models and what is sent where.
  // The model list is the CLI's own, so new models appear without an update.
  let { store }: { store: SettingsStore } = $props()

  const prefs = $derived(store.data.preferences)
  const cli = $derived<CliKind>(prefs.aiCli === 'codex' ? 'codex' : 'claude')
  const name = $derived(cli === 'codex' ? 'Codex' : 'Claude Code')
  const exe = $derived(cli === 'codex' ? 'codex.exe' : 'claude.exe')
  const path = $derived(cli === 'codex' ? prefs.aiCodexPath : prefs.aiClaudePath)
  const model = $derived(cli === 'codex' ? prefs.aiCodexModel : prefs.aiClaudeModel)
  const effort = $derived(cli === 'codex' ? prefs.aiCodexEffort : prefs.aiClaudeEffort)

  const onOff: { value: 'on' | 'off'; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]
  const pictureModes: { value: 'useful' | 'all'; label: string }[] = [
    { value: 'useful', label: 'Where useful' },
    { value: 'all', label: 'Every page' },
  ]
  const clis: { value: CliKind; label: string }[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
  ]

  let info = $state<CliInfo | null>(null)
  /** The CLI's models; null while loading, and stays null when `failed`. */
  let models = $state<CliModel[] | null>(null)
  let failed = $state(false)

  $effect(() => {
    if (!prefs.aiEnabled) return
    const [c, p] = [cli, path]
    info = null
    models = null
    failed = false
    let stale = false
    lookupInfo(c, p)
      .then((v) => !stale && (info = v))
      .catch(() => !stale && (info = { found: false, path: null, version: null }))
    lookupModels(c, p)
      .then((v) => !stale && (models = v))
      .catch(() => !stale && (failed = true))
    return () => (stale = true)
  })

  /** What the model list offers: the CLI's (or common choices when it failed), plus a stored model it no longer lists. */
  const groups = $derived(withStored(groupModels(failed ? FALLBACK[cli] : (models ?? []), cli), model))
  const all = $derived([...groups.main, ...groups.more])
  const efforts = $derived(effortsFor(all, model))
  const selected = $derived(all.find((m) => m.value === model))
  /** Only Codex has text-only models; Claude's pictures always go through. */
  const textOnly = $derived(cli === 'codex' && !picturesFor(all, model))

  const optionText = (m: { label: string; description: string }) =>
    m.description ? `${m.label} — ${m.description}` : m.label

  /** The effort a model change cleared because the new model offers none; restored by the next model that has it. */
  let cleared: string | null = null
  // The memory belongs to the CLI whose effort was cleared: the other CLI's
  // models must not pick it up.
  $effect(() => {
    void cli
    cleared = null
  })

  function setModel(value: string) {
    store.setPreference(cli === 'codex' ? 'aiCodexModel' : 'aiClaudeModel', value)
    // Only a model from the CLI's real list says what it supports; a hand-typed
    // id or the fallback list leaves the effort alone.
    const known = !failed && (models?.some((x) => x.value === value) || (cli === 'codex' && value === ''))
    if (!known) return
    const offered = effortsFor(all, value)
    if (offered.length === 0) {
      // Nothing to show or pass (e.g. Haiku): clear it, but remember it for the way back.
      if (effort !== '') {
        cleared = effort
        setEffort('', true)
      }
    } else if (effort === '' && cleared !== null && offered.includes(cleared)) {
      setEffort(cleared, true)
      cleared = null
    } else if (effort !== '' && !offered.includes(effort)) {
      // An effort the model does not offer would make the CLI refuse the run.
      setEffort(offered.includes('medium') ? 'medium' : '', true)
    }
  }
  function setEffort(value: string, auto = false) {
    if (!auto) cleared = null
    store.setPreference(cli === 'codex' ? 'aiCodexEffort' : 'aiClaudeEffort', value)
  }
  const setPath = (value: string) => store.setPreference(cli === 'codex' ? 'aiCodexPath' : 'aiClaudePath', value.trim())

  // Test: one tiny request through the same path as a real generation.
  let testing = $state(false)
  let result = $state<{ ok: boolean; text: string } | null>(null)
  let abort: AbortController | null = null

  onDestroy(() => abort?.abort())

  // A result belongs to the configuration it was run with.
  $effect(() => {
    void [cli, model, effort, path]
    result = null
  })

  async function test() {
    testing = true
    result = null
    abort = new AbortController()
    try {
      const { cliGenerator } = await import('./cliGenerator')
      let works = false
      const outcome = await cliGenerator(cliConfigOf(prefs)).generate(
        { system: SYSTEM_PROMPT, user: userPrompt({ explain: [{ page: 1, text: 'Test page: the water cycle.' }], context: null, total: 1, pictures: [], note: 'claude' }), images: [] },
        (line) => {
          if (parseAnswerLine(line)) works = true
        },
        abort.signal,
      )
      if (outcome !== 'cancelled') {
        result = works
          ? { ok: true, text: 'Works' }
          : { ok: false, text: `${name} answered, but not in the expected form. Try another model.` }
      }
    } catch (e) {
      const message =
        typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e)
      result = { ok: false, text: message }
    } finally {
      testing = false
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
  <div class="row">
    <div class="text">
      <span class="label">Tool</span>
      <span class="hint">The command-line tool that writes the explanations.</span>
    </div>
    <Segmented label="Tool" options={clis} value={cli} onchange={(v) => store.setPreference('aiCli', v)} />
  </div>

  <p class="status-line" class:missing={info !== null && !info.found} role="status">
    {#if info === null}
      Looking for {name}…
    {:else if info.found}
      <span aria-hidden="true">✓</span> {name}{info.version ? ` ${info.version}` : ''} found
      {#if info.path}<span class="hint path">{info.path}</span>{/if}
    {:else}
      <span aria-hidden="true">✗</span> {name} was not found
    {/if}
  </p>

  <div class="grid">
    <label for="ai-path">Path to {exe}</label>
    <input
      id="ai-path"
      type="text"
      spellcheck="false"
      placeholder={`C:\\…\\${exe}`}
      value={path}
      onchange={(e) => setPath(e.currentTarget.value)}
    />
    <span class="hint full">
      Only needed when it is not found. Enter the full path to the executable; when set, it is the one used.
    </span>

    <label for="ai-model">Model</label>
    <select id="ai-model" value={model} disabled={models === null && !failed} onchange={(e) => setModel(e.currentTarget.value)}>
      {#each groups.main as m (m.value)}
        <option value={m.value}>{optionText(m)}</option>
      {/each}
      {#if groups.more.length > 0}
        <optgroup label="More versions">
          {#each groups.more as m (m.value)}
            <option value={m.value}>{optionText(m)}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
    {#if failed}
      <label for="ai-model-id">Model ID</label>
      <input
        id="ai-model-id"
        type="text"
        spellcheck="false"
        value={model}
        onchange={(e) => setModel(e.currentTarget.value.trim())}
      />
      <span class="hint full">Could not load the model list from the CLI; showing common choices.</span>
    {:else if selected?.description}
      <span class="hint full">{selected.description}</span>
    {/if}
    {#if textOnly}
      <span class="hint full" role="note">This model can't read pictures; only page text is sent.</span>
    {/if}

    {#if efforts.length > 0}
      <label for="ai-effort">Effort</label>
      <select id="ai-effort" value={efforts.includes(effort) ? effort : ''} onchange={(e) => setEffort(e.currentTarget.value)}>
        <option value="">CLI default</option>
        {#each efforts as level (level)}
          <option value={level}>{level}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="row">
    <div class="text">
      <span class="label">Page pictures</span>
      <span class="hint">Pictures help with diagrams, screenshots and scanned pages, and use more of your plan.</span>
    </div>
    <Segmented
      label="Page pictures"
      options={pictureModes}
      value={prefs.aiPictures}
      onchange={(v) => store.setPreference('aiPictures', v)}
    />
  </div>

  <div class="actions">
    <button type="button" class="button" disabled={testing || (info !== null && !info.found)} onclick={test}>
      {testing ? 'Testing…' : 'Test'}
    </button>
    <span class="result" class:error={result !== null && !result.ok} role="status">{result?.text ?? ''}</span>
  </div>

  <p class="note" role="note">
    Uses your own Claude or ChatGPT subscription through its command-line tool. Use at your own risk: the provider may
    not allow this, and may limit or stop it. The document's text and page pictures are sent to the provider when you generate.
  </p>
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
  .status-line {
    margin: 0 0 12px;
    color: var(--success);
  }
  .status-line.missing {
    color: var(--danger);
  }
  .path {
    margin-left: 6px;
    user-select: all;
  }
  .grid {
    display: grid;
    grid-template-columns: 90px 1fr;
    align-items: center;
    gap: 8px 12px;
  }
  .full {
    grid-column: 2;
    margin-top: -4px;
  }
  label {
    color: var(--text);
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
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
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 0 12px;
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
  .result {
    color: var(--success);
    font-size: 12px;
  }
  .result.error {
    color: var(--danger);
  }
  .note {
    margin: 0;
    padding: 8px 10px;
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text-strong);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
