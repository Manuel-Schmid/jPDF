import { describe, expect, it } from 'vitest'
import {
  DARK_OPACITY_FACTOR,
  MAX_SAMPLES,
  canvasOf,
  isDarkBackground,
  luminance,
  markStyle,
  medianLuminance,
  rectSamples,
  sampleDark,
  spread,
  bandSamples,
} from '../../../src/tools/marker/background'
import { fakeCanvas } from './fakeCanvas'

describe('luminance', () => {
  it('is 0 for black, 1 for white, and weights green most', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(1)
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0))
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })

  it('median ignores a minority of glyph pixels', () => {
    const px = (v: number) => [v, v, v, 255]
    // 6 dark background pixels, 3 white text pixels.
    const data = [...Array(6)].flatMap(() => px(20)).concat([...Array(3)].flatMap(() => px(255)))
    expect(medianLuminance(data)).toBeCloseTo(20 / 255)
  })
})

describe('isDarkBackground', () => {
  it('no patches: not dark', () => {
    expect(isDarkBackground([])).toBe(false)
  })
  it('white paper with a black glyph patch or two stays light', () => {
    expect(isDarkBackground([1, 1, 1, 0.05, 1, 1, 1, 1])).toBe(false)
  })
  it('a dark slide is dark', () => {
    expect(isDarkBackground([0.1, 0.12, 0.9, 0.1])).toBe(true)
  })
  it('a mark across a dark-to-light boundary counts as dark (stays visible on the dark part)', () => {
    expect(isDarkBackground([0.1, 0.1, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95])).toBe(true)
  })
  it('mid grey is light, dark grey is dark', () => {
    expect(isDarkBackground([0.5])).toBe(false)
    expect(isDarkBackground([0.25])).toBe(true)
  })
})

describe('spread', () => {
  it('keeps short lists and spreads long ones evenly, first and last kept', () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3])
    const out = spread([...Array(100).keys()], 5)
    expect(out).toEqual([0, 25, 50, 74, 99])
  })
})

describe('rectSamples', () => {
  it('four points per non-empty rect, inside it', () => {
    const pts = rectSamples([
      { left: 0, top: 0, right: 100, bottom: 10 },
      { left: 5, top: 5, right: 5, bottom: 20 },
    ])
    expect(pts).toHaveLength(4)
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(100)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(10)
    }
  })
})

describe('bandSamples', () => {
  it('each point with the band edges above and below it', () => {
    expect(bandSamples([[10, 50]], 10)).toEqual([
      [10, 42],
      [10, 50],
      [10, 58],
    ])
  })
})

describe('sampleDark', () => {
  it('null without a canvas or a 2D context (e.g. jsdom)', () => {
    expect(sampleDark(null, [[1, 1]])).toBeNull()
    const c = document.createElement('canvas')
    expect(sampleDark(c, [[1, 1]])).toBeNull()
  })

  it('reads the canvas pixels under client points (canvas px = 2× client px)', () => {
    // Left half of the page (client x < 200, canvas x < 400) dark, right half white.
    const { canvas } = fakeCanvas((x) => (x < 400 ? 15 : 255), { left: 100, top: 50 })
    expect(
      sampleDark(canvas, [
        [150, 100],
        [250, 100],
      ]),
    ).toBe(true)
    expect(
      sampleDark(canvas, [
        [350, 100],
        [450, 100],
      ]),
    ).toBe(false)
  })

  it('points off the canvas are skipped; none left: null', () => {
    const { canvas } = fakeCanvas(() => 0)
    expect(
      sampleDark(canvas, [
        [-10, 5],
        [5000, 5],
      ]),
    ).toBeNull()
    expect(
      sampleDark(canvas, [
        [-10, 5],
        [5, 5],
      ]),
    ).toBe(true)
  })

  it('black text on white stays light: the patch median is the paper', () => {
    // A 1-px glyph stem every 4 canvas px (25% ink), as in body text.
    const { canvas } = fakeCanvas((x) => (x % 4 === 0 ? 0 : 255))
    const pts = [...Array(16).keys()].map((i): [number, number] => [10 + i * 20, 10])
    expect(sampleDark(canvas, pts)).toBe(false)
  })

  it(`reads at most ${MAX_SAMPLES} small patches however many points`, () => {
    const { canvas, reads } = fakeCanvas(() => 255)
    const pts = [...Array(500).keys()].map((i): [number, number] => [i % 400, 10])
    expect(sampleDark(canvas, pts)).toBe(false)
    expect(reads.count).toBe(MAX_SAMPLES)
  })
})

describe('canvasOf', () => {
  it('finds only a direct canvas child', () => {
    const page = document.createElement('div')
    const inner = document.createElement('div')
    inner.append(document.createElement('canvas'))
    page.append(inner)
    expect(canvasOf(page)).toBeNull()
    const c = document.createElement('canvas')
    page.prepend(c)
    expect(canvasOf(page)).toBe(c)
    expect(canvasOf(null)).toBeNull()
  })
})

describe('markStyle', () => {
  it('light: multiply at the set opacity; dark: normal at reduced opacity', () => {
    expect(markStyle(false, 1)).toEqual({ blend: 'multiply', opacity: 1 })
    expect(markStyle(true, 1)).toEqual({ blend: 'normal', opacity: DARK_OPACITY_FACTOR })
    expect(markStyle(true, 0.5).opacity).toBeCloseTo(0.5 * DARK_OPACITY_FACTOR)
  })
})
