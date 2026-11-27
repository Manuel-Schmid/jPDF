<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Copy from '@lucide/svelte/icons/copy'
  import { openUrl } from '../core/ipc/api'
  import { writeClipboardText } from '../core/ipc/clipboard'
  import type { CliInfo, CliKind } from './cliIpc'
  import { CLI_SETUP, signInCommand } from './cliSetup'

  // Settings → AI when the chosen CLI can't be used yet: not installed, or
  // (Claude) installed but not signed in. Says what to do, step by step,
  // with commands to copy, and offers the other CLI when that one is there.
  let {
    cli,
    name,
    info,
    other,
    onrecheck,
    onuseother,
  }: {
    cli: CliKind
    name: string
    info: CliInfo
    /** The other CLI, when it was found (null: not found, or not looked up). */
    other: { name: string } | null
    onrecheck(): void
    onuseother(): void
  } = $props()

  const setup = $derived(CLI_SETUP[cli])
  const signedOut = $derived(info.found && info.signedIn === false)

  /** The command most recently copied (shows a check mark for a moment). */
  let copied = $state<string | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  async function copy(text: string) {
    try {
      await writeClipboardText(text)
      copied = text
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => (copied = null), 1500)
    } catch (e) {
      console.error('Could not copy the command', e)
    }
  }

  function openDocs() {
    openUrl(setup.docs).catch((e) => console.error('Could not open the install page', e))
  }
</script>

{#snippet command(text: string)}
  <div class="command">
    <code>{text}</code>
    <button type="button" class="icon" aria-label="Copy command" title="Copy" onclick={() => copy(text)}>
      {#if copied === text}<Check size={14} />{:else}<Copy size={14} />{/if}
    </button>
  </div>
{/snippet}

<div class="guide" role="group" aria-label="Set up {name}">
  {#if signedOut}
    <p>
      {info.desktop
        ? `This is the copy inside the Claude desktop app. It is signed in only inside the app until you sign in once outside it.`
        : `${name} is installed, but not signed in.`}
    </p>
    <ol>
      <li>Open PowerShell and run this, then follow the sign-in steps in your browser: {@render command(signInCommand(info))}</li>
      <li>Then check again.</li>
    </ol>
  {:else}
    <p>{setup.about}</p>
    <ol>
      <li>
        Install it: open PowerShell and run {@render command(setup.install)}
        <button type="button" class="link" onclick={openDocs}>Install guide</button>
      </li>
      <li>{setup.signIn}</li>
      <li>Then check again. Still not found? Restart JuliePDF, or set the path below.</li>
    </ol>
  {/if}
  <div class="buttons">
    <button type="button" class="button" onclick={onrecheck}>Check again</button>
    {#if other && !signedOut}
      <span class="other">{other.name} was found.</span>
      <button type="button" class="button" onclick={onuseother}>Use {other.name} instead</button>
    {/if}
  </div>
</div>

<style>
  .guide {
    display: grid;
    gap: 8px;
    margin: -6px 0 14px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.5;
  }
  p,
  ol {
    margin: 0;
  }
  ol {
    display: grid;
    gap: 6px;
    padding-left: 18px;
  }
  .command {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding: 4px 4px 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  code {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    color: var(--text-strong);
    font-family: ui-monospace, Consolas, monospace;
    user-select: all;
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .link {
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .other {
    margin-left: 8px;
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
  .button:hover {
    border-color: var(--text-muted);
  }
</style>
