import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASCENT, boxHeight, boxRect, defaultBoxWidth, frameOrigin, frameSize, layoutLines, LINE_HEIGHT, lineX, measureHelvetica,
  measureHelveticaBold, measurer, minBoxWidth, pageBoxRect, PLACEHOLDER, screenDx, TEXT_PADDING, wrapText,
} from '../../../src/core/geometry/textLayout'

const half = (s: string, size: number) => s.length * size * 0.5

describe('wrapText', () => {
  it('wrapText splits on newline', () => {
    expect(wrapText('one\ntwo\n\nfour', 10, 1000, half)).toEqual(['one', 'two', '', 'four'])
    expect(wrapText('a\r\nb', 10, 1000, half)).toEqual(['a', 'b'])
    expect(wrapText('', 10, 1000, half)).toEqual([''])
  })

  it('wrapText wraps words at maxWidth', () => {
    expect(wrapText('aa bb cc', 10, 30, half)).toEqual(['aa bb', 'cc'])
  })

  it('wrapText breaks overlong word', () => {
    expect(wrapText('abcdefgh', 10, 30, half)).toEqual(['abcdef', 'gh'])
    expect(wrapText('x abcdefgh y', 10, 30, half)).toEqual(['x', 'abcdef', 'gh y'])
  })

  it('keeps at least one character per line when a single character is too wide', () => {
    expect(wrapText('abc', 10, 2, half)).toEqual(['a', 'b', 'c'])
  })

  it('breaks after a hyphen, keeping it on the first line (like the textarea)', () => {
    expect(wrapText('well-known', 10, 30, half)).toEqual(['well-', 'known'])
    expect(wrapText('a well-known', 10, 50, half)).toEqual(['a well-', 'known'])
    expect(wrapText('well-known', 10, 100, half)).toEqual(['well-known'])
  })

  it('spaces at a wrap boundary hang on the line: no leading space on the next line', () => {
    expect(wrapText('aaaaaa  bb', 10, 30, half)).toEqual(['aaaaaa', 'bb'])
    expect(wrapText('aaaa  bb', 10, 30, half)).toEqual(['aaaa', 'bb'])
  })

  it('keeps leading and inner spaces', () => {
    expect(wrapText('  a  b', 10, 1000, half)).toEqual(['  a  b'])
  })
})

describe('boxRect', () => {
  it('boxRect height for 2 lines at 10pt: one full line, a 1.089 em last line, padding', () => {
    const r = boxRect([100, 500], 200, 2, 10)
    expect(r[3] - r[1]).toBeCloseTo(25.89)
    expect(r).toEqual([100, 500 - boxHeight(2, 10), 300, 500])
  })

  it('leaves as much room below the descenders as above the capitals', () => {
    // Helvetica: cap height 0.718 em, descent 0.207 em; first baseline at pad + ASCENT.
    const fontSize = 10
    for (const lines of [1, 3]) {
      const lastBaseline = TEXT_PADDING + (ASCENT + (lines - 1) * LINE_HEIGHT) * fontSize
      const above = TEXT_PADDING + (ASCENT - 0.718) * fontSize
      const below = boxHeight(lines, fontSize) - lastBaseline - 0.207 * fontSize
      expect(below).toBeCloseTo(above, 6)
    }
  })

  it('exports the layout constants', () => {
    expect([TEXT_PADDING, LINE_HEIGHT]).toEqual([1.5, 1.2])
  })

  it('a new box is just wide enough for the placeholder', () => {
    // "Text" is 1.945 em in Helvetica: 19.45 + 2 * 1.5 padding, rounded up.
    expect(defaultBoxWidth(10)).toBe(23)
    expect(measureHelvetica(PLACEHOLDER, 10)).toBeLessThanOrEqual(defaultBoxWidth(10) - 2 * TEXT_PADDING)
    expect(defaultBoxWidth(6)).toBeLessThan(defaultBoxWidth(12))
    // One "W" (0.944 em) plus 1.5 pt padding on each side.
    expect(minBoxWidth(10)).toBeCloseTo(12.44)
  })

  it('screenDx measures along screen right on every rotation', () => {
    expect(screenDx([100, 500], [130, 480], 0)).toBe(30)
    expect(screenDx([100, 500], [130, 540], 90)).toBe(40)
    expect(screenDx([100, 500], [70, 480], 180)).toBe(30)
    expect(screenDx([100, 500], [130, 460], 270)).toBe(40)
  })
})

describe('rotated pages', () => {
  // A box 200 wide and 32 tall on screen, top-left on screen at PDF (100, 500).
  it('pageBoxRect places the screen frame on each rotation', () => {
    expect(pageBoxRect([100, 500], 200, 32, 0)).toEqual([100, 468, 300, 500])
    expect(pageBoxRect([100, 500], 200, 32, 90)).toEqual([100, 500, 132, 700])
    expect(pageBoxRect([100, 500], 200, 32, 180)).toEqual([-100, 500, 100, 532])
    expect(pageBoxRect([100, 500], 200, 32, 270)).toEqual([68, 300, 100, 500])
  })

  it('frameOrigin and frameSize invert pageBoxRect', () => {
    for (const rot of [0, 90, 180, 270]) {
      const r = pageBoxRect([100, 500], 200, 32, rot)
      expect(frameOrigin(r, rot)).toEqual([100, 500])
      expect(frameSize(r, rot)).toEqual({ width: 200, height: 32 })
    }
  })
})

describe('measureHelvetica', () => {
  it('uses the Helvetica AFM widths', () => {
    expect(measureHelvetica('a', 10)).toBeCloseTo(5.56)
    expect(measureHelvetica('Hi!', 1000)).toBeCloseTo(722 + 222 + 278)
    expect(measureHelvetica('Übung', 1000)).toBeCloseTo(722 + 556 + 556 + 556 + 556)
    expect(measureHelvetica('ß€—', 1000)).toBeCloseTo(611 + 556 + 1000)
  })

  it('measures unknown characters (one per code point) like the "?" they are saved as', () => {
    expect(measureHelvetica('😀', 1000)).toBe(556)
    expect(measureHelvetica('あ', 1000)).toBe(556)
  })
})

describe('lineX', () => {
  // "Hi" at 10 pt is 9.44 wide (H 722 + i 222).
  it('starts left-aligned lines at the inner left edge', () => {
    expect(lineX('Hi', 10, 20, 'left')).toBe(0)
  })
  it('centres lines in the text area', () => {
    expect(lineX('Hi', 10, 20, 'center')).toBeCloseTo((20 - 9.44) / 2, 9)
  })
  it('puts right-aligned lines flush with the right edge', () => {
    expect(lineX('Hi', 10, 20, 'right')).toBeCloseTo(20 - 9.44, 9)
    expect(lineX('', 10, 20, 'right')).toBe(20)
  })
})

describe('Helvetica-Bold metrics', () => {
  it('uses the Helvetica-Bold AFM widths', () => {
    expect(measureHelveticaBold('Hi!', 1000)).toBeCloseTo(722 + 278 + 333)
    expect(measureHelveticaBold('ß€—', 1000)).toBeCloseTo(611 + 556 + 1000)
    // Unencodable characters are a bold '?'.
    expect(measureHelveticaBold('😀', 1000)).toBe(611)
  })

  it('picks the measurer by weight', () => {
    expect(measurer(true)).toBe(measureHelveticaBold)
    expect(measurer(false)).toBe(measureHelvetica)
    expect(measurer(undefined)).toBe(measureHelvetica)
  })

  it('bold text wraps, aligns and sizes new boxes with the bold widths', () => {
    const text = 'bold words'
    expect(measureHelveticaBold(text, 10)).toBeGreaterThan(measureHelvetica(text, 10))
    // Just wide enough for the regular line: the bold one wraps.
    const width = measureHelvetica(text, 10) + 2 * TEXT_PADDING + 0.1
    expect(layoutLines(text, 10, width)).toEqual([text])
    expect(layoutLines(text, 10, width, true)).toEqual(['bold', 'words'])
    expect(lineX('Hi', 10, 20, 'right', true)).toBeCloseTo(20 - 10)
    expect(lineX('Hi', 10, 20, 'right')).toBeCloseTo(20 - 9.44)
    expect(defaultBoxWidth(10, true)).toBe(Math.ceil(measureHelveticaBold(PLACEHOLDER, 10) + 2 * TEXT_PADDING))
    expect(minBoxWidth(10, true)).toBeCloseTo(measureHelveticaBold('W', 10) + 2 * TEXT_PADDING)
  })
})

describe('width tables', () => {
  /** A width table of src-tauri/src/pdf/winansi.rs: widths by WinAnsi byte from 0x20 (0 = undefined). */
  function rustTable(name: string): number[] {
    const rs = readFileSync('src-tauri/src/pdf/winansi.rs', 'utf8')
    const body = rs.match(new RegExp(`const ${name}: \\[u16; 224\\] = \\[([\\s\\S]*?)\\];`))![1]
    return body.replace(/\/\/.*$/gm, '').split(',').map((v) => v.trim()).filter(Boolean).map(Number)
  }
  /** The character WinAnsi writes as `byte`. */
  const decoder = new TextDecoder('windows-1252')
  const char = (byte: number) => decoder.decode(new Uint8Array([byte]))

  it.each([
    ['HELVETICA_WIDTHS', measureHelvetica],
    ['HELVETICA_BOLD_WIDTHS', measureHelveticaBold],
  ] as const)('%s match the TS measurer for every WinAnsi character', (name, measure) => {
    const table = rustTable(name)
    expect(table).toHaveLength(224)
    table.forEach((w, i) => {
      // Bytes WinAnsi leaves undefined are never written.
      if (w === 0) return
      expect([i + 0x20, measure(char(i + 0x20), 1000)]).toEqual([i + 0x20, w])
    })
  })
})
