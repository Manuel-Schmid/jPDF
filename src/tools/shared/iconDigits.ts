/**
 * Digits drawn as stroke paths for the toolbar icons. SVG `<text>` depends on
 * the installed font and its metrics, which makes a number hard to centre and
 * blurry at 20 px; these paths look the same everywhere.
 *
 * Each glyph is drawn in a 5 × 8 box (origin top left), meant to be stroked
 * with round caps and joins.
 */
const GLYPHS: Record<string, string> = {
  '0': 'M2.5 0C0.8 0 0 1.6 0 4s0.8 4 2.5 4S5 6.4 5 4 4.2 0 2.5 0Z',
  '1': 'M0.9 1.6 2.9 0v8',
  '2': 'M0.3 1.6C0.7 0.5 1.5 0 2.6 0 4 0 4.8 0.9 4.8 2.1c0 1-0.6 1.8-1.6 2.7L0.2 8h4.8',
  '3': 'M0.4 0.6C0.9 0.2 1.7 0 2.5 0 3.9 0 4.7 0.8 4.7 1.9S3.8 3.8 2.4 3.8c1.6 0 2.6 0.8 2.6 2.1S4 8 2.5 8C1.6 8 0.8 7.7 0.2 7.2',
  '4': 'M3.8 8V0L0 5.6h5',
  '5': 'M4.6 0H1L0.6 3.7c0.5-0.4 1.1-0.6 1.9-0.6 1.5 0 2.5 1 2.5 2.4S4 8 2.4 8C1.5 8 0.8 7.7 0.2 7.2',
  '6': 'M4.3 0.5C3.8 0.2 3.2 0 2.6 0 1 0 0 1.6 0 4.3 0 6.6 1 8 2.5 8S5 6.9 5 5.4 4 2.9 2.6 2.9C1.4 2.9 0.4 3.6 0 4.6',
  '7': 'M0 0h5L1.8 8',
  '8': 'M2.5 3.8C1.2 3.8 0.4 3.1 0.4 1.9S1.2 0 2.5 0s2.1 0.7 2.1 1.9-0.8 1.9-2.1 1.9Zm0 0C1 3.8 0 4.6 0 5.9S1 8 2.5 8 5 7.2 5 5.9 4 3.8 2.5 3.8Z',
  '9': 'M0.7 7.5C1.2 7.8 1.8 8 2.4 8 4 8 5 6.4 5 3.7 5 1.4 4 0 2.5 0S0 1.1 0 2.6s1 2.5 2.4 2.5c1.2 0 2.2-0.7 2.6-1.7',
}

const GLYPH_W = 5
const GLYPH_H = 8
/** Space between two digits, in glyph units. */
const GAP = 1.6

export interface PlacedDigit {
  d: string
  /** `transform` for the path: moves the 5 × 8 glyph into place and scales it. */
  transform: string
}

export interface DigitRun {
  digits: PlacedDigit[]
  /** Stroke width to set on the paths so it comes out as the requested width after scaling. */
  strokeWidth: number
}

/**
 * Lays out the digits of `label` centred on (cx, cy), `height` tall, drawn
 * with strokes `strokeWidth` wide (both in icon units). A run wider than
 * `maxWidth` is scaled down as a whole. Characters other than 0–9 are skipped.
 */
export function layoutDigits(
  label: string,
  { cx, cy, height, strokeWidth, maxWidth = Infinity }: {
    cx: number
    cy: number
    height: number
    strokeWidth: number
    maxWidth?: number
  },
): DigitRun {
  const glyphs = [...label].filter((ch) => ch in GLYPHS)
  const units = glyphs.length * GLYPH_W + Math.max(0, glyphs.length - 1) * GAP
  // The stroke overhangs the glyph box by half its width on either side.
  const k = Math.min(height / GLYPH_H, (maxWidth - strokeWidth) / Math.max(units, 1))
  const top = cy - (GLYPH_H * k) / 2
  let x = cx - (units * k) / 2
  const digits = glyphs.map((ch) => {
    const placed = { d: GLYPHS[ch], transform: `translate(${round(x)} ${round(top)}) scale(${round(k)})` }
    x += (GLYPH_W + GAP) * k
    return placed
  })
  return { digits, strokeWidth: round(strokeWidth / k) }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
