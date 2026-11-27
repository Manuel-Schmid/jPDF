<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Copy from '@lucide/svelte/icons/copy'
  import { openUrl } from '../core/ipc/api'
  import { writeClipboardText } from '../core/ipc/clipboard'
  import type { CliInfo, CliKind } from './cliIpc'
  import { CLI_SETUP, setupTokenCommand, signInCommand } from './cliSetup'
  import TokenInput from './TokenInput.svelte'

  // Settings → AI when the chosen CLI can't be used yet: not installed, or
  // (Claude) installed but not signed in. Says what to do, step by step,
  // with commands to copy, and offers the other CLI when that one is there.
  // For Claude the main way to sign in is a token that lasts a year
  // (`claude setup-token`), pasted here: a normal sign-in can expire and
  // would have to be repeated.
  let {
    cli,
    name,
    info,
    other,
    onrecheck,
    onuseother,
    onsavetoken,
  }: {
    cli: CliKind
    name: string
    info: CliInfo
    /** The other CLI, when it was found (null: not found, or not looked up). */
    other: { name: string } | null
    onrecheck(): void
    onuseother(): void
    /** Saves Claude's sign-in token (and checks again). */
    onsavetoken(token: string): void
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
  {#if other && !signedOut}
    <!-- The quickest way out comes first, apart from the install steps. -->
    <div class="shortcut">
      <span>{other.name} is already installed on this computer.</span>
      <button type="button" class="button" onclick={onuseother}>Use {other.name} instead</button>
    </div>
  {/if}
  {#snippet tokenSteps(command_: string)}
    <li>
      Create a sign-in token that lasts a year: open PowerShell, run this and approve in your browser.
      {@render command(command_)}
      If the browser then shows a code, copy it into the PowerShell window and press Enter. PowerShell then prints the
      token, a long text starting with sk-ant-oat01-.
    </li>
    <li>
      Paste the token here. JuliePDF keeps it and gives it only to Claude Code, so you won't have to sign in again for a
      year. <TokenInput onsave={onsavetoken} />
    </li>
  {/snippet}

  {#if signedOut}
    <p>
      {info.desktop
        ? `This is the copy inside the Claude desktop app. It is signed in only inside the app, not when JuliePDF runs it.`
        : `${name} is installed, but not signed in.`}
    </p>
    <ol>{@render tokenSteps(setupTokenCommand(info))}</ol>
    <p class="secondary">
      Or sign in the usual way (you may have to sign in again from time to time), then check again:
      {@render command(signInCommand(info))}
    </p>
  {:else if cli === 'claude'}
    <p>{setup.about}</p>
    <ol>
      <li>
        Install it: open PowerShell and run {@render command(setup.install)}
        <button type="button" class="link" onclick={openDocs}>Install guide</button>
      </li>
      {@render tokenSteps(setupTokenCommand(null))}
      <li>Still not found? Check again, restart JuliePDF, or set the path below.</li>
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
  </div>
</div>

<style>
  .guide {
    display: grid;
    /* Never wider than the panel: long commands wrap inside it. */
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 10px;
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
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    padding-left: 18px;
  }
  li :global(.token) {
    margin-top: 4px;
  }
  .secondary {
    color: var(--text-muted);
  }
  .shortcut {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-strong);
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
    /* Wrapped, not scrolled: the whole command stays visible (Copy copies it exactly). */
    overflow-wrap: anywhere;
    color: var(--text-strong);
    font-family: ui-monospace, Consolas, monospace;
    user-select: all;
  }
  .icon {
    flex-shrink: 0;
    align-self: flex-start;
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
