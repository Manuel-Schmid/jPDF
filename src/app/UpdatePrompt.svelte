<script lang="ts" module>
  import type { UpdateChoice } from './updates.svelte'

  interface Pending {
    version: string
    notes: string | undefined
    resolve(choice: UpdateChoice): void
  }

  let pending: Pending | null = $state.raw(null)
  /** The download progress while one runs: a fraction 0..1, or null when the size is unknown. */
  let progress: number | null | undefined = $state(undefined)

  /**
   * Offers the update to `version`. Escape or a click outside counts as
   * Later (offered again next start); a newer prompt answers an older one
   * still open with Later.
   */
  export function askToUpdate(version: string, notes: string | undefined): Promise<UpdateChoice> {
    pending?.resolve('later')
    return new Promise((resolve) => {
      const p: Pending = {
        version,
        notes,
        resolve: (choice) => {
          if (pending === p) pending = null
          resolve(choice)
        },
      }
      pending = p
    })
  }

  /** Shows the download progress (a fraction, or null when unknown); undefined hides it. */
  export function showUpdateProgress(fraction: number | null | undefined): void {
    progress = fraction
  }
</script>

<script lang="ts">
  import Modal from '../ui/Modal.svelte'
</script>

{#if pending}
  {@const p = pending}
  <Modal label="Update available" onclose={() => p.resolve('later')}>
    <p class="message">JuliePDF {p.version} is available. Update now?</p>
    {#if p.notes}
      <div class="notes">{p.notes}</div>
    {/if}
    <p class="hint">Open files are closed first; you're asked to save any changes. JuliePDF restarts when it's done.</p>
    <div class="buttons">
      <button type="button" class="primary" onclick={() => p.resolve('update')}>Update now</button>
      <button type="button" onclick={() => p.resolve('later')}>Later</button>
    </div>
  </Modal>
{:else if progress !== undefined}
  <!-- Not dismissable: the download finishes (or fails with a toast) on its own. -->
  <Modal label="Downloading update" onclose={() => {}}>
    <p class="message">Downloading the update…{progress === null ? '' : ` ${Math.round(progress * 100)} %`}</p>
    <div
      class="bar"
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
    >
      <div class="fill" class:indeterminate={progress === null} style:width={progress === null ? '30%' : `${progress * 100}%`}></div>
    </div>
  </Modal>
{/if}

<style>
  .message {
    margin: 0 0 16px;
    color: var(--text-strong);
  }
  .notes {
    max-height: 160px;
    overflow: auto;
    margin: 0 0 16px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .hint {
    margin: 0 0 20px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    min-width: 88px;
    height: 32px;
    padding: 0 14px;
    font: inherit;
    color: var(--text-strong);
    background: var(--surface-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  button:hover {
    border-color: var(--text-muted);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .primary {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
  }
  .primary:hover {
    border-color: var(--text-strong);
  }
  .bar {
    width: 320px;
    max-width: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--surface-hover);
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
  .fill.indeterminate {
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
</style>
