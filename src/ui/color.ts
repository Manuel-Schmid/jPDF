import type { RGB } from '../core/session/model'

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

function channel(v: number): string {
  const n = Math.round(Math.min(1, Math.max(0, v)) * 255)
  return n.toString(16).padStart(2, '0')
}

/** RGB (0..1) → `#rrggbb` (lower case). */
export function rgbToHex([r, g, b]: RGB): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `#rrggbb` → RGB (0..1, rounded to 3 decimals), or null if malformed. */
export function hexToRgb(hex: string): RGB | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const c = (s: string) => Math.round((parseInt(s, 16) / 255) * 1000) / 1000
  return [c(m[1]), c(m[2]), c(m[3])]
}

/**
 * A typed or pasted hex code → RGB, or null if it is not one: `#` optional,
 * 6 digits or 3 (`#f80` = `#ff8800`), any case, surrounding spaces ignored.
 */
export function parseHex(text: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  const d = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return hexToRgb(`#${d}`)
}

/**
 * Whether a colour is too dark to stand out on the dark toolbar strip
 * (relative luminance below 0.2): tool icons then add a light halo.
 */
export function isDark([r, g, b]: RGB): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2
}

/** WCAG relative luminance of an sRGB colour (0..1 channels). */
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Whether dark ink reads better than light ink on `color` drawn at `opacity`
 * over `backdrop` (browsers blend in sRGB): compares the contrast against
 * black and white.
 */
export function prefersDarkInk(color: RGB, opacity: number, backdrop: RGB): boolean {
  const mix = (i: number) => backdrop[i] + (color[i] - backdrop[i]) * opacity
  const l = luminance([mix(0), mix(1), mix(2)])
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05)
}
