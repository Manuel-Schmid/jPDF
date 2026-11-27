<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import { open as openDialog } from '@tauri-apps/plugin-dialog'
  import { forgetCli, lookupInfo, lookupModels, rememberTokenCheck, tokenCheckOf } from './cliCache'
  import { isAuthError, TOKEN_REJECTED } from './cliSetup'
  import CliSetupGuide from './CliSetupGuide.svelte'
  import { setAiEnabled } from '../toolbar/aiTools'
  import TokenInput from './TokenInput.svelte'
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
  /** Claude's saved sign-in token (`claude setup-token`); never shown, only whether there is one. */
  const token = $derived(cli === 'claude' ? prefs.aiClaudeToken : '')

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

  /** Bumped by "Check again": the lookups below run again. */
  let recheck = $state(0)
  /** The other CLI, when the chosen one is missing and that one was found (offered instead). */
  let other = $state<{ cli: CliKind; name: string } | null>(null)
  const otherOf = (c: CliKind): { cli: CliKind; name: string; path: string } =>
    c === 'codex' ? { cli: 'claude', name: 'Claude Code', path: prefs.aiClaudePath } : { cli: 'codex', name: 'Codex', path: prefs.aiCodexPath }
  $effect(() => {
    if (!prefs.aiEnabled) return
    const [c, p, t] = [cli, path, token]
    void recheck
    info = null
    models = null
    failed = false
    other = null
    let stale = false
    lookupInfo(c, p, t)
      .then((v) => {
        if (stale) return
        info = v
        if (v.found) return
        // Offered only once the chosen one is known to be missing.
        const o = otherOf(c)
        lookupInfo(o.cli, o.path, o.cli === 'claude' ? prefs.aiClaudeToken : '')
          .then((w) => !stale && w.found && (other = { cli: o.cli, name: o.name }))
          .catch(() => {})
      })
      .catch(() => !stale && (info = { found: false, path: null, version: null, signedIn: null, authMethod: null, desktop: false }))
    lookupModels(c, p, t)
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

  /** Asks the CLI again (after installing or signing in), without reopening Settings. */
  function checkAgain() {
    forgetCli(cli, path)
    recheck++
  }

  /**
   * Saves (or with '' removes) Claude's sign-in token and asks the CLI
   * again. `auth status` counts any token as signed in without checking it,
   * so Test is what shows that it works.
   */
  function setToken(value: string) {
    store.setPreference('aiClaudeToken', value)
    forgetCli('claude', prefs.aiClaudePath)
    recheck++
  }

  /**
   * Whether Claude accepted the saved token: 'checking' while the check
   * (Test's request) runs, null before it ran. Checked automatically once
   * per token and app session, since `auth status` accepts any token.
   */
  let tokenCheck = $state<'checking' | 'ok' | 'failed' | null>(null)
  $effect(() => {
    const known = token ? tokenCheckOf(token) : undefined
    tokenCheck = known === undefined ? null : known ? 'ok' : 'failed'
  })

  async function browse() {
    try {
      const picked = await openDialog({
        title: `Choose ${exe}`,
        multiple: false,
        directory: false,
        filters: [{ name: name, extensions: ['exe', 'cmd'] }],
      })
      if (typeof picked === 'string') setPath(picked)
    } catch (e) {
      console.error('Could not open the file dialog', e)
    }
  }

  /** Usable as it is: found, not known to be signed out, and not with a token Claude rejected. */
  const ready = $derived(info !== null && info.found && info.signedIn !== false && !(token && tokenCheck === 'failed'))
  /** Tokens this panel already checked on its own: a check that fails for another reason (offline) is not repeated. */
  const autoChecked = new Set<string>()
  // A saved token not checked yet this session is checked right away (once).
  $effect(() => {
    if (!ready || !token || tokenCheck !== null || testing || autoChecked.has(token)) return
    autoChecked.add(token)
    untrack(() => void test())
  })
  /**
   * Signed in with a long-lived token JuliePDF did not save: one set as
   * CLAUDE_CODE_OAUTH_TOKEN in the user's Windows environment (read when
   * JuliePDF started). Nothing to paste then.
   */
  const envToken = $derived(ready && !token && info?.authMethod === 'oauth_token')

  // Test: one tiny request through the same path as a real generation.
  let testing = $state(false)
  let result = $state<{ ok: boolean; text: string } | null>(null)
  let abort: AbortController | null = null

  onDestroy(() => abort?.abort())

  // A result belongs to the configuration it was run with.
  $effect(() => {
    void [cli, model, effort, path, token]
    result = null
  })

  async function test() {
    testing = true
    result = null
    abort = new AbortController()
    // The token this test runs with: its verdict is remembered for it.
    const checked = token
    if (checked) tokenCheck = 'checking'
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
        // An answer of any form means the token got through.
        if (checked) settleTokenCheck(checked, true)
      }
    } catch (e) {
      const message =
        typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e)
      const rejected = checked !== '' && isAuthError(message)
      result = { ok: false, text: rejected ? TOKEN_REJECTED : message }
      // Another failure (offline, a model the plan lacks) says nothing about the token.
      if (checked && rejected) settleTokenCheck(checked, false)
    } finally {
      testing = false
      if (checked && tokenCheck === 'checking' && checked === token) tokenCheck = null
    }
  }

  function settleTokenCheck(checked: string, accepted: boolean) {
    rememberTokenCheck(checked, accepted)
    if (checked === token) tokenCheck = accepted ? 'ok' : 'failed'
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
    onchange={(v) => setAiEnabled(store, v === 'on')}
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

  <p class="status-line" class:missing={info !== null && !info.found} class:warning={info !== null && info.found && !ready} role="status">
    {#if info === null}
      Looking for {name}…
    {:else if info.found}
      <span aria-hidden="true">{ready ? '✓' : '!'}</span>
      {name}{info.version ? ` ${info.version}` : ''} found{info.desktop ? ' in the Claude desktop app' : ''}{ready
        ? token
          ? tokenCheck === 'checking' || tokenCheck === null
            ? ', checking your saved token…'
            : ', signed in with your saved token'
          : envToken
            ? ', signed in with a token from your Windows environment'
            : ''
        : token && tokenCheck === 'failed'
          ? ', but Claude rejected the saved token'
          : ', but not signed in'}
      {#if info.path}<span class="hint path">{info.path}</span>{/if}
    {:else}
      <span aria-hidden="true">✗</span> {name} was not found
    {/if}
  </p>

  {#if info !== null && !ready}
    <CliSetupGuide
      {cli}
      {name}
      info={token && tokenCheck === 'failed' ? { ...info, signedIn: false } : info}
      other={other ? { name: other.name } : null}
      onrecheck={checkAgain}
      onuseother={() => other && store.setPreference('aiCli', other.cli)}
      onsavetoken={setToken}
    />
  {/if}

  <!-- Most people never need the path: it waits under a disclosure, open while one is set. -->
  <details class="custom-path" open={path !== ''}>
    <summary>Installed it somewhere else?</summary>
    <div class="grid">
      <label for="ai-path">Path to {exe}</label>
      <div class="path-row">
        <input
          id="ai-path"
          type="text"
          spellcheck="false"
          placeholder={`C:\\…\\${exe}`}
          value={path}
          onchange={(e) => setPath(e.currentTarget.value)}
        />
        <button type="button" class="button" onclick={browse}>Browse…</button>
      </div>
      <span class="hint full">When set, this file is used instead of searching for {name}. Leave it empty to search.</span>
    </div>
  </details>

  <div class="grid">
    {#if cli === 'claude' && ready}
      <!-- Signed in already: a token can still replace a sign-in that expires. -->
      <span class="label-cell">Sign-in token</span>
      {#if envToken}
        <span class="hint-cell">From your Windows environment (CLAUDE_CODE_OAUTH_TOKEN): nothing to set up here.</span>
      {:else if token}
        <div class="token-saved">
          <span>Saved. It keeps Claude Code signed in for a year from when you created it.</span>
          <button type="button" class="button" onclick={() => setToken('')}>Remove</button>
        </div>
      {:else}
        <TokenInput onsave={setToken} />
        <span class="hint full">
          Optional. Run claude setup-token in PowerShell and paste the token it prints, so you don't have to sign in again
          for a year.
        </span>
      {/if}
    {/if}

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
    <button type="button" class="button" disabled={testing || (info !== null && !ready)} onclick={test}>
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
    gap: 24px;
    padding: 16px 0;
  }
  .text {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .label {
    color: var(--text-strong);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.4;
  }
  .beta {
    margin-left: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--font-size-dialog-hint);
    font-weight: 600;
  }
  .status-line {
    margin: 0 0 14px;
    color: var(--success);
  }
  .status-line.missing {
    color: var(--danger);
  }
  .status-line.warning {
    color: var(--accent);
  }
  .custom-path {
    margin: 0 0 14px;
  }
  .custom-path summary {
    color: var(--text);
    font-size: var(--font-size-dialog-hint);
    cursor: pointer;
  }
  .custom-path .grid {
    margin-top: 10px;
  }
  .label-cell,
  .hint-cell {
    color: var(--text);
  }
  .token-saved {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    color: var(--text);
  }
  .path-row {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  /* On its own line under the status: long paths (the desktop app's copy) wrap there cleanly. */
  .path {
    display: block;
    margin-top: 2px;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .grid {
    display: grid;
    /* As wide as the longest label (the path), so the fields line up. */
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: 10px 14px;
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
    height: 32px;
    padding: 0 10px;
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
    gap: 12px;
    margin: 18px 0 14px;
  }
  .button {
    padding: 6px 14px;
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
    color: var(--text-disabled);
    cursor: default;
  }
  .result {
    color: var(--success);
    font-size: var(--font-size-dialog-hint);
  }
  .result.error {
    color: var(--danger);
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text-strong);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.45;
  }
</style>
