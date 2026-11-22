import type { Rect } from '../../core/session/model'

/**
 * A rotation in progress, for the overlay to draw the selection box turning
 * with the pointer: `rect` (PDF, the box as at the press, without its turn)
 * on `page`, turned by `angle` (degrees, counter-clockwise). Ink, lines and
 * groups have no turn of their own: without this their box would be the
 * bounds of the turned points, which change shape as they turn.
 */
export interface RotatingFrame {
  page: number
  rect: Rect
  angle: number
}

/** The rotating frame of one tool handler, read reactively by the overlay (ToolHandler.rotatingFrame). */
export class LiveRotation {
  frame = $state.raw<RotatingFrame | null>(null)
}
