<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import X from '@lucide/svelte/icons/x'
  import { hasAnyExplanation } from '../core/session/explanations'
  import type { DocumentSession } from '../core/session/session.svelte'
  import { toasts } from '../ui/toasts.svelte'
  import { generationAction } from './action'
  import type { AiConfig } from './ipc'
  import { generationRuns } from './runs.svelte'
  import { retryGeneration, startGeneration } from './startGeneration'

  // Status-bar controls of AI explanations (shown only while AI features are
  // on): the generate button, progress with Cancel, or why a run stopped
  // with Retry.
  let {
    session,
    ai,
    confirm,
  }: {
    session: DocumentSession
    ai: AiConfig
    confirm(message: string, confirmLabel: string): Promise<boolean>
  } = $props()

  const run = $derived(generationRuns.get(session.id))
  const action = $derived(generationAction(hasAnyExplanation(session.explanations)))

  function report(e: unknown) {
    console.error('Could not start the explanation generation', e)
    toasts.show('Could not start generating explanations', 'error')
  }
</script>

{#if run && run.status !== 'stopped'}
  <span class="progress" role="status">
    <LoaderCircle size={14} class="spin" />
    {run.note ?? (run.status === 'reading' ? 'Reading pages…' : `Explaining ${run.done}/${run.total}`)}
  </span>
  <button type="button" aria-label="Cancel explanations" title="Cancel" onclick={() => generationRuns.cancel(session.id)}>
    <X size={16} />
  </button>
{:else if run}
  <span class="stopped" title={run.message ?? ''}>
    <TriangleAlert size={14} />
    <span class="message">{run.message}</span>
  </span>
  {#if run.retry.length > 0}
    <button
      type="button"
      class="text"
      title="Continue with the {run.retry.length} missing pages"
      onclick={() => retryGeneration(session, ai).catch(report)}
    >
      <RotateCw size={14} /> Retry
    </button>
  {/if}
  <button type="button" aria-label="Dismiss" title="Dismiss" onclick={() => generationRuns.clear(session.id)}>
    <X size={16} />
  </button>
{:else}
  <button
    type="button"
    class="text"
    title="{action.label} (AI, Beta): the document's text is sent to {ai.model || 'the AI provider'}"
    onclick={() => startGeneration(session, ai, { confirm }).catch(report)}
  >
    <Sparkles size={14} /> {action.label}
  </button>
{/if}

<style>
  .progress,
  .stopped {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stopped {
    min-width: 0;
    max-width: 320px;
    color: var(--accent);
  }
  .message {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 28px;
    height: 24px;
    padding: 0 4px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--transition);
  }
  button.text {
    padding: 0 8px;
  }
  button:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  :global(.spin) {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
