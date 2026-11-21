<script lang="ts" module>
  export type RestoreChoice = 'restore' | 'discard' | 'later'

  interface Pending {
    fileName: string
    changed: boolean
    resolve(choice: RestoreChoice): void
  }

  let pending: Pending | null = $state.raw(null)

  /**
   * Offers back the unsaved changes a crashed run left for `fileName`;
   * `changed`: the file changed on disk since, which the prompt says.
   * Escape or a click outside counts as Later (asked again next start);
   * a newer prompt answers an older one still open with Later.
   */
  export function askToRestore(fileName: string, changed: boolean): Promise<RestoreChoice> {
    pending?.resolve('later')
    return new Promise((resolve) => {
      const p: Pending = {
        fileName,
        changed,
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
  <Modal label="Restore unsaved changes" onclose={() => p.resolve('later')}>
    <p class="message">JuliePDF closed unexpectedly. Restore unsaved changes to {p.fileName}?</p>
    {#if p.changed}
      <p class="warning">{p.fileName} has changed since. Some changes may not be restored or may not fit the file.</p>
    {/if}
    <div class="buttons">
      <button type="button" class="primary" onclick={() => p.resolve('restore')}>
        {p.changed ? 'Restore anyway' : 'Restore'}
      </button>
      <button type="button" onclick={() => p.resolve('discard')}>Discard</button>
      <button type="button" onclick={() => p.resolve('later')}>Later</button>
    </div>
  </Modal>
{/if}

<style>
  .message {
    margin: 0 0 20px;
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .warning {
    margin: -8px 0 20px;
    color: var(--text-muted);
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
