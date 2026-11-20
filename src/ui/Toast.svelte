<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import Info from '@lucide/svelte/icons/info'
  import X from '@lucide/svelte/icons/x'
  import { toasts, type ToastItem, type ToastStore } from './toasts.svelte'

  // Toast stack, bottom-centre above the status bar.
  let { store = toasts }: { store?: ToastStore } = $props()

  function act(t: ToastItem) {
    store.dismiss(t.id)
    t.action?.run()
  }
</script>

<div class="stack">
  {#each store.items as t (t.id)}
    <div
      class="toast {t.kind}"
      role={t.kind === 'error' ? 'alert' : 'status'}
    >
      <span class="icon">
        {#if t.kind === 'error'}<CircleAlert size={16} />{:else if t.kind === 'warning'}<TriangleAlert size={16} />{:else}<Info size={16} />{/if}
      </span>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button type="button" class="action" onclick={() => act(t)}>{t.action.label}</button>
      {/if}
      <button type="button" class="close" aria-label="Dismiss" onclick={() => store.dismiss(t.id)}>
        <X size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    left: 50%;
    bottom: calc(var(--statusbar-h) + var(--toast-lift, 0px) + 16px);
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, calc(100vw - 32px));
    padding: 8px 8px 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    color: var(--text-strong);
    animation: in 150ms ease-out;
  }
  .icon {
    display: grid;
    flex: none;
    color: var(--accent);
  }
  .error .icon {
    color: var(--danger);
  }
  .msg {
    flex: 1;
  }
  button {
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .action {
    padding: 4px 8px;
    color: var(--accent);
    font-weight: 600;
  }
  .action:hover {
    background: var(--accent-soft);
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--text);
  }
  .close:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
