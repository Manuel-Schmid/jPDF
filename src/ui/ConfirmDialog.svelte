<script lang="ts" module>
  interface Pending {
    message: string
    confirmLabel: string
    resolve(ok: boolean): void
  }

  let pending: Pending | null = $state.raw(null)

  /**
   * Asks the user to confirm an action (e.g. overwriting explanations).
   * Escape or a click outside counts as Cancel; a newer question cancels an
   * older one still open.
   */
  export function confirmAction(message: string, confirmLabel = 'Continue'): Promise<boolean> {
    pending?.resolve(false)
    return new Promise((resolve) => {
      const p: Pending = {
        message,
        confirmLabel,
        resolve: (ok) => {
          if (pending === p) pending = null
          resolve(ok)
        },
      }
      pending = p
    })
  }
</script>

<script lang="ts">
  import Modal from './Modal.svelte'
</script>

{#if pending}
  {@const p = pending}
  <Modal label="Confirm" onclose={() => p.resolve(false)}>
    <p class="message">{p.message}</p>
    <div class="buttons">
      <button type="button" class="primary" onclick={() => p.resolve(true)}>{p.confirmLabel}</button>
      <button type="button" onclick={() => p.resolve(false)}>Cancel</button>
    </div>
  </Modal>
{/if}

<style>
  .message {
    max-width: 420px;
    margin: 0 0 20px;
    color: var(--text-strong);
    line-height: 1.45;
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
  }
  button:hover {
    border-color: var(--text-muted);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .primary {
    color: var(--bg-deep);
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
