<script lang="ts">
  import Logo from './Logo.svelte'

  let { onOpen, onMerge }: { onOpen: () => void; onMerge?: () => void } = $props()
</script>

<div class="empty">
  <Logo size="lg" full />
  <button type="button" class="open" onclick={() => onOpen()}>Open PDF</button>
  <p class="hint">or drop a file here · Ctrl+O</p>
  {#if onMerge}
    <button type="button" class="link" onclick={() => onMerge()}>Merge PDFs…</button>
  {/if}
</div>

<style>
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
  }
  .open {
    background: var(--accent);
    color: var(--on-accent);
    border: 0;
    border-radius: var(--radius-md);
    padding: 10px 28px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: filter var(--transition);
  }
  .open:hover {
    filter: brightness(1.1);
  }
  .link {
    background: transparent;
    border: 0;
    padding: 4px 8px;
    color: var(--text);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color var(--transition);
  }
  .link:hover {
    color: var(--text-strong);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
  }
</style>
