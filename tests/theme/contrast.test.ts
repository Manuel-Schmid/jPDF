import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/theme/tokens.css', 'utf8')

/** The `--name: #rrggbb` colour tokens of the rule block starting at `selector`. */
function palette(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]),
  )
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const dark = palette(':root')
const themes = {
  dark,
  // The light block only overrides colours: anything it leaves out is the dark value.
  light: { ...dark, ...palette(":root[data-theme='light']") },
}

describe.each(Object.entries(themes))('%s palette (tokens.css)', (_, p) => {
  // Hints and secondary text in settings, menus and dialogs sit on these.
  it.each(['--bg-deep', '--bg', '--surface'])(
    'muted text is readable on %s (WCAG AA 4.5:1)',
    (bg) => {
      expect(contrast(p['--text-muted'], p[bg])).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('muted text stays quieter than normal text', () => {
    expect(contrast(p['--text-muted'], p['--surface'])).toBeLessThan(
      contrast(p['--text'], p['--surface']),
    )
  })

  it('disabled text is dimmer than muted text, so it still reads as disabled', () => {
    expect(contrast(p['--text-disabled'], p['--surface'])).toBeLessThan(
      contrast(p['--text-muted'], p['--surface']),
    )
  })
})
