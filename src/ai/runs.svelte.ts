/**
 * State of the explanation generation of each document (by session id),
 * shown in the status bar. Small on purpose: the generation code itself is
 * loaded only when a generation starts (see generate.ts).
 */
import { SvelteMap } from 'svelte/reactivity'

export interface GenerationRun {
  /** 'reading': collecting page text; 'running': streaming; 'stopped': ended early (see message). */
  status: 'reading' | 'running' | 'stopped'
  /** Pages explained so far, of `total` pages with text. */
  done: number
  total: number
  /** Why it stopped (status 'stopped'). */
  message: string | null
  /** Page indices Retry asks for (empty: nothing to retry). */
  retry: number[]
  /** Shown instead of the progress while waiting (e.g. before retrying a busy provider). */
  note: string | null
  /** The backup's model once the backup provider took over; null while the main one works. */
  backup: string | null
  /** Aborts a reading or running generation. */
  controller: AbortController | null
}

export class GenerationRuns {
  private runs = new SvelteMap<string, GenerationRun>()

  get(sessionId: string): GenerationRun | undefined {
    return this.runs.get(sessionId)
  }

  isActive(sessionId: string): boolean {
    const s = this.runs.get(sessionId)?.status
    return s === 'reading' || s === 'running'
  }

  /** Replaces (or starts) the run's state with `patch` applied. */
  update(sessionId: string, patch: Partial<GenerationRun>): void {
    const prev: GenerationRun = this.runs.get(sessionId) ?? {
      status: 'reading', done: 0, total: 0, message: null, retry: [], note: null, backup: null, controller: null,
    }
    this.runs.set(sessionId, { ...prev, ...patch })
  }

  cancel(sessionId: string): void {
    this.runs.get(sessionId)?.controller?.abort()
  }

  /** Forgets the run (finished, or its stop message dismissed). */
  clear(sessionId: string): void {
    this.runs.delete(sessionId)
  }
}

export const generationRuns = new GenerationRuns()
