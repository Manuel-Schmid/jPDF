import type { Annotation, RGB } from '../session/model'

/**
 * Eyedropper pick mode (see ColorPicker): while it is on, the next primary
 * press on a page takes that spot's colour instead of reaching the page.
 * Pages register a colour source (see registerColorSource); nothing listens
 * while the mode is off, so it costs nothing on the drawing path.
 */

/** The colour at client coordinates on a page, or null when it has none there. */
export type ColorSource = (clientX: number, clientY: number) => RGB | null

/** Elements inside these let presses through (the eyedropper button toggles the mode itself). */
export const EYEDROPPER_IGNORE = '[data-eyedropper-ignore]'

/** Cursor while picking: a pipette whose tip (bottom left) is the hot spot. */
export const EYEDROPPER_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke="white" stroke-width="4"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></g>' +
      '<g stroke="black" stroke-width="1.8"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></g></svg>',
  )}") 2 22, crosshair`

const sources = new Map<Element, ColorSource>()

/** Registers `el`'s colour source (a page); returns the unregister function. */
export function registerColorSource(el: Element, source: ColorSource): () => void {
  sources.set(el, source)
  return () => {
    if (sources.get(el) === source) sources.delete(el)
  }
}

class EyedropperState {
  /** A pick is in progress (the cursor is the pipette). */
  active = $state(false)
}

export const eyedropper = new EyedropperState()

/** Settles the pick in progress (null = cancelled) and stops listening. */
let finish: ((c: RGB | null) => void) | null = null

/**
 * Starts a pick; resolves with the picked colour, or null when cancelled
 * (Escape, a press outside the pages, another pick, cancelPick). A press on
 * a page that has no colour there leaves the mode on.
 */
export function pickColor(): Promise<RGB | null> {
  cancelPick()
  return new Promise((resolve) => {
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest(EYEDROPPER_IGNORE)) return
      const source = e.button === 0 ? sourceAt(e.clientX, e.clientY) : null
      if (!source) {
        done(null)
        return
      }
      // Window capture runs first: neither the page, its tool nor an open
      // popup's outside-press handler sees this press.
      e.preventDefault()
      e.stopImmediatePropagation()
      const c = source(e.clientX, e.clientY)
      if (c) done(c)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      done(null)
    }
    const root = document.documentElement
    function done(c: RGB | null) {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      root.style.removeProperty('--eyedropper-cursor')
      delete root.dataset.eyedropper
      eyedropper.active = false
      finish = null
      resolve(c)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    root.style.setProperty('--eyedropper-cursor', EYEDROPPER_CURSOR)
    root.dataset.eyedropper = ''
    eyedropper.active = true
    finish = done
  })
}

/** Cancels the pick in progress, if any (its promise resolves with null). */
export function cancelPick(): void {
  finish?.(null)
}

/** The registered source whose element is under the point (pages do not overlap). */
function sourceAt(x: number, y: number): ColorSource | null {
  for (const [el, source] of sources) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return source
  }
  return null
}

/**
 * An annotation's main colour as stored (exact, no opacity or blending): the
 * text colour of a text box, the border of a shape (its fill without one).
 * Null for an image.
 */
export function annotationColor(a: Annotation): RGB | null {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'ink':
      return a.color
    case 'freetext':
      return a.textColor
    case 'shape':
      return a.border?.color ?? a.fill?.color ?? null
    case 'line':
      return a.border.color
    case 'image':
      return null
  }
}

/**
 * The rendered page colour at client coordinates: one pixel of `canvas`
 * (never a whole-page read), composited on white where it is transparent.
 * Null when the point is outside it or it cannot be read.
 */
export function canvasColorAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): RGB | null {
  const r = canvas.getBoundingClientRect()
  if (r.width === 0 || r.height === 0 || canvas.width === 0 || canvas.height === 0) return null
  const x = Math.floor(((clientX - r.left) / r.width) * canvas.width)
  const y = Math.floor(((clientY - r.top) / r.height) * canvas.height)
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null
  let d: Uint8ClampedArray
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    d = ctx.getImageData(x, y, 1, 1).data
  } catch {
    return null
  }
  const a = d[3] / 255
  const ch = (v: number) => (v * a) / 255 + (1 - a)
  return [ch(d[0]), ch(d[1]), ch(d[2])]
}
