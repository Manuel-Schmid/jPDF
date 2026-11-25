import type { HighlightAnnotation } from '../../core/session/model'
import { newId } from '../../core/session/model'
import type { ToolContext } from '../../core/registry/tools'
import { settings as appSettings } from '../../core/settings/settings.svelte'
import { toasts } from '../../ui/toasts.svelte'
import { listenForTextSelection as onTextSelected, markupFromSelection } from '../shared/textMarkup'
import type { MarkerSettings } from './settings'
import { highlightsCommand } from './merging'
import { canvasOf, markStyle, rectSamples, sampleDark } from './background'

export const FALLBACK_HINT = 'markerFallback'
export const FALLBACK_MESSAGE = 'No selectable text on this page — using freehand marker'

/**
 * Commits the native text selection as highlights when a pointer is released
 * while the marker is in text mode. Returns the detach function.
 */
export function listenForTextSelection(ctx: ToolContext, settings: () => MarkerSettings): () => void {
  // Freehand mode: presses near text draw, they never start a selection.
  const active = () => settings().mode === 'text'
  return onTextSelected((sel) => {
    const s = settings()
    if (s.mode !== 'text') return false
    const modifiedAt = new Date().toISOString()
    const highlights = markupFromSelection(
      sel,
      (page, quads, { layer, rects }): HighlightAnnotation => {
        // On a dark page multiply would vanish: normal blend, lower opacity
        // (read once per page here, at commit). Light pages keep the default
        // (no `blend`: multiply).
        const dark = sampleDark(canvasOf(layer.parentElement), rectSamples(rects)) === true
        const look = markStyle(dark, s.opacity)
        return {
          id: newId(),
          page,
          sourceRef: null,
          modifiedAt,
          author: appSettings.data.author,
          kind: 'highlight',
          quads,
          color: s.color,
          opacity: look.opacity,
          ...(dark ? { blend: 'normal' as const } : {}),
        }
      },
    )
    if (highlights.length === 0) return false
    // Overlapping highlights of one colour become one layer (no double darkening).
    ctx.execute(highlightsCommand(ctx.session.store, highlights))
    return true
  }, undefined, active)
}

/**
 * Text mode on a page without text (no text layer there): tells the user
 * once ever that freehand is used instead. Blank space on a page with text
 * draws freehand silently.
 */
export function noteFreehandFallback(): void {
  if (appSettings.data.hints[FALLBACK_HINT]) return
  toasts.show(FALLBACK_MESSAGE)
  appSettings.setHint(FALLBACK_HINT)
}
