import type { Annotation } from '../../core/session/model'
import type { ToolContext } from '../../core/registry/tools'

export interface PreviewFrame {
  /** Shows `current()` as the live preview on the next animation frame (at most once per frame). */
  schedule(): void
  /** Drops a pending frame and clears the preview. */
  clear(): void
}

/**
 * rAF-throttled live preview of an annotation being drawn: pointer moves can
 * arrive far more often than frames, and every preview re-renders the overlay.
 * `current` builds the annotation from the gesture so far (null = nothing).
 */
export function createPreviewFrame(ctx: ToolContext, current: () => Annotation | null): PreviewFrame {
  let frame = 0
  return {
    schedule() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const a = current()
        if (a) ctx.preview.set(a)
      })
    },
    clear() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      ctx.preview.set(null)
    },
  }
}
