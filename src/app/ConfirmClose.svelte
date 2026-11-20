<script lang="ts" module>
  export type CloseChoice = 'save' | 'discard' | 'cancel'

  interface Pending {
    fileName: string
    resolve(choice: CloseChoice): void
  }

  let pending: Pending | null = $state.raw(null)

  /**
   * Shows "Save changes to <file name>?" and resolves with the user's choice.
   * Escape or a click outside counts as Cancel; a newer prompt cancels an
   * older one still open.
   */
  export function askToSave(fileName: string): Promise<CloseChoice> {
    pending?.resolve('cancel')
    return new Promise((resolve) => {
      const p: Pending = {
        fileName,
        resolve: (choice) => {
          if (pending === p) pending = null
          resolve(choice)
        },
      }
      pending = p
    })
  }
</script>

<script lang="ts">
  import Modal from '../ui/Modal.svelte'
</script>

{#if pending}
  {@const p = pending}
  <Modal label="Unsaved changes" onclose={() => p.resolve('cancel')}>
    <p class="message">Save changes to {p.fileName}?</p>
    <div class="buttons">
      <button type="button" class="primary" onclick={() => p.resolve('save')}>Save</button>
      <button type="button" onclick={() => p.resolve('discard')}>Don't save</button>
      <button type="button" onclick={() => p.resolve('cancel')}>Cancel</button>
    </div>
  </Modal>
{/if}

<style>
  .message {
    margin: 0 0 20px;
    color: var(--text-strong);
    overflow-wrap: anywhere;
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
</style>
