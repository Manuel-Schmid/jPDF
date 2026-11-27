<script lang="ts">
  import { looksLikeClaudeToken } from './cliSetup'

  // Pasting Claude's year-long sign-in token (`claude setup-token`). A
  // password field: the token is never shown, and it is saved only on Save
  // (or Enter), then cleared from the field. Something that is not a token
  // (usually the browser's one-time code) is refused with what to do instead.
  let { onsave }: { onsave(token: string): void } = $props()

  let value = $state('')
  const trimmed = $derived(value.trim())
  const odd = $derived(trimmed !== '' && !looksLikeClaudeToken(trimmed))

  function save() {
    if (!trimmed || odd) return
    onsave(trimmed)
    value = ''
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }
</script>

<div class="token">
  <div class="row">
    <input
      type="password"
      aria-label="Sign-in token"
      placeholder="Paste the token (sk-ant-…)"
      autocomplete="off"
      spellcheck="false"
      bind:value
      {onkeydown}
    />
    <button type="button" class="button" disabled={!trimmed || odd} onclick={save}>Save</button>
  </div>
  {#if odd}
    <span class="odd" role="alert">
      That is not the token yet: a token starts with sk-ant-oat01-. If the browser showed you a code, paste that code into
      the PowerShell window where setup-token is waiting; the token appears there afterwards.
    </span>
  {/if}
</div>

<style>
  .token {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .row {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  input {
    flex: 1;
    box-sizing: border-box;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .odd {
    color: var(--accent);
    font-size: var(--font-size-dialog-hint);
  }
  /* As Settings → AI's buttons. */
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
</style>
