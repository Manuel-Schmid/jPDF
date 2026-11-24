import { clampScale } from './layout'

/** The parts of a `Touch` a pinch reads. */
export interface TouchPoint {
  identifier: number
  clientX: number
  clientY: number
}

/** A touchscreen pinch in progress: its two fingers and the zoom it started at. */
export interface Pinch {
  ids: [number, number]
  /** Distance between the fingers when the pinch started (CSS px). */
  startDist: number
  startScale: number
}

const distance = (a: TouchPoint, b: TouchPoint) =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

/**
 * Starts a pinch from the touches on the screen (`TouchEvent.touches`): the
 * first two fingers. Returns the pinch and the point between the fingers
 * (client coordinates, the zoom's anchor), or null with fewer than two.
 */
export function startPinch(
  touches: ArrayLike<TouchPoint>,
  scale: number,
): { pinch: Pinch; mid: { x: number; y: number } } | null {
  if (touches.length < 2) return null
  const a = touches[0],
    b = touches[1]
  return {
    pinch: { ids: [a.identifier, b.identifier], startDist: distance(a, b), startScale: scale },
    mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
  }
}

/**
 * The zoom for the pinch's fingers now: the start zoom times how much the
 * fingers spread (clamped like every zoom). Null once one of its two fingers
 * has lifted (the pinch is over).
 */
export function pinchScale(pinch: Pinch, touches: ArrayLike<TouchPoint>): number | null {
  let a: TouchPoint | undefined, b: TouchPoint | undefined
  for (let i = 0; i < touches.length; i++) {
    const t = touches[i]
    if (t.identifier === pinch.ids[0]) a = t
    else if (t.identifier === pinch.ids[1]) b = t
  }
  if (!a || !b) return null
  // Fingers that started on the same spot: nothing to scale by.
  if (pinch.startDist < 1) return pinch.startScale
  return clampScale((pinch.startScale * distance(a, b)) / pinch.startDist)
}
