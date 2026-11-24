/**
 * State of the explanation generation of each document (by session id),
 * shown in the status bar. Small on purpose: the generation code itself is
 * loaded only when a generation starts (see generate.ts).
 */
import { SvelteMap } from 'svelte/reactivity'

export interface GenerationRun {
  /**
   * 'preparing': reading page text and deciding which pages get a picture;
   * 'running': rendering pictures and streaming; 'stopped': ended early (see message).
   */
  status: 'preparing' | 'running' | 'stopped'
  /** 'preparing': pages read so far, of `total` pages; 'running': pages explained so far, of `total` pages to explain. */
  done: number
  total: number
  /** Why it stopped (status 'stopped'). */
  message: string | null
  /** Page indices Retry asks for (empty: nothing to retry). */
  retry: number[]
  /** Aborts a preparing or running generation. */
  controller: AbortController | null
  /**
   * 'running', while the pictures of the request about to be sent render:
   * how many are done, of how many (null otherwise).
   */
  pictures?: { done: number; total: number } | null
}

export class GenerationRuns {
  private runs = new SvelteMap<string, GenerationRun>()

  get(sessionId: string): GenerationRun | undefined {
    return this.runs.get(sessionId)
  }

  isActive(sessionId: string): boolean {
    const s = this.runs.get(sessionId)?.status
    return s === 'preparing' || s === 'running'
  }

  /** Replaces (or starts) the run's state with `patch` applied. */
  update(sessionId: string, patch: Partial<GenerationRun>): void {
    const prev: GenerationRun = this.runs.get(sessionId) ?? {
      status: 'preparing', done: 0, total: 0, message: null, retry: [], controller: null,
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
