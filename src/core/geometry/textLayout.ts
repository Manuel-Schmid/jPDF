import type { Point, Rect, TextAlign } from '../session/model'

/**
 * Inner padding of a text box and line height factor (pt). The padding keeps
 * the box barely larger than its text; a coloured background still gets a
 * thin margin around the glyphs.
 */
export const TEXT_PADDING = 1.5, LINE_HEIGHT = 1.2
/** Shown in an empty box while it is placed and edited; a new box is just wide enough for it. */
export const PLACEHOLDER = 'Text'
/** First baseline below the top padding, as a fraction of the font size (same in the saved appearance). */
export const ASCENT = 0.8
/** Helvetica's cap height and descent (AFM CapHeight 718, Descender -207), as fractions of the font size. */
const CAP_HEIGHT = 0.718, DESCENT = 0.207
/**
 * Height of the last line, in em: from its line top down to its descenders,
 * plus the gap the first line has above its capitals (ASCENT - CAP_HEIGHT),
 * so the text sits as close to the bottom edge as to the top. A full line
 * (LINE_HEIGHT) would leave 0.11 em more below the descenders than above the
 * capitals.
 */
const LAST_LINE = ASCENT + DESCENT + (ASCENT - CAP_HEIGHT)
/** What the last line leaves out of a full line's height (em); the editor trims it from its bottom padding. */
export const LAST_LINE_TRIM = LINE_HEIGHT - LAST_LINE

/**
 * Helvetica and Helvetica-Bold advance widths (AFM, 1/1000 em) by code point:
 * ASCII 0x20–0x7E, Latin-1 0xA0–0xFF and the WinAnsi specials. Saved boxes are
 * drawn with Helvetica (bold boxes with Helvetica-Bold), so wrapping with
 * these widths matches what viewers lay out. Helvetica-Oblique and
 * -BoldOblique have the upright fonts' widths. The same tables as
 * `src-tauri/src/pdf/winansi.rs`.
 */
const WIDTHS = new Map<number, number>()
const BOLD_WIDTHS = new Map<number, number>()
const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // '0'..'?'
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // '@'..'O'
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 'P'..'_'
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // '`'..'o'
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 'p'..'~'
]
const BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, // '0'..'?'
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, // '@'..'O'
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, // 'P'..'_'
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, // '`'..'o'
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, // 'p'..'~'
]
const LATIN1 = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 0xA0..0xAF
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 0xB0..0xBF
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 0xC0..0xCF
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 0xD0..0xDF
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, // 0xE0..0xEF
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500, // 0xF0..0xFF
]
const BOLD_LATIN1 = [
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 0xA0..0xAF
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 0xB0..0xBF
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 0xC0..0xCF
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 0xD0..0xDF
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, // 0xE0..0xEF
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556, // 0xF0..0xFF
]
/** The WinAnsi specials (0x80–0x9F): character, regular width, bold width. */
const SPECIALS: [string, number, number][] = [
  ['€', 556, 556], ['‚', 222, 278], ['ƒ', 556, 556], ['„', 333, 500], ['…', 1000, 1000], ['†', 556, 556],
  ['‡', 556, 556], ['ˆ', 333, 333], ['‰', 1000, 1000], ['Š', 667, 667], ['‹', 333, 333], ['Œ', 1000, 1000],
  ['Ž', 611, 611], ['‘', 222, 278], ['’', 222, 278], ['“', 333, 500], ['”', 333, 500], ['•', 350, 350],
  ['–', 556, 556], ['—', 1000, 1000], ['˜', 333, 333], ['™', 1000, 1000], ['š', 500, 556], ['›', 333, 333],
  ['œ', 944, 944], ['ž', 500, 500], ['Ÿ', 667, 667],
]
ASCII.forEach((w, i) => WIDTHS.set(0x20 + i, w))
LATIN1.forEach((w, i) => WIDTHS.set(0xa0 + i, w))
BOLD_ASCII.forEach((w, i) => BOLD_WIDTHS.set(0x20 + i, w))
BOLD_LATIN1.forEach((w, i) => BOLD_WIDTHS.set(0xa0 + i, w))
for (const [c, w, bold] of SPECIALS) {
  WIDTHS.set(c.codePointAt(0)!, w)
  BOLD_WIDTHS.set(c.codePointAt(0)!, bold)
}
/** Width of characters WinAnsi cannot encode: they are saved as '?' (556; 611 in bold). */
const UNKNOWN_WIDTH = 556, BOLD_UNKNOWN_WIDTH = 611

function measure(s: string, size: number, widths: Map<number, number>, unknown: number): number {
  let units = 0
  for (const ch of s) units += widths.get(ch.codePointAt(0)!) ?? unknown
  return (units * size) / 1000
}

/** Width of `s` in Helvetica at `size` pt (AFM metrics; deterministic, no canvas). */
export function measureHelvetica(s: string, size: number): number {
  return measure(s, size, WIDTHS, UNKNOWN_WIDTH)
}

/** Width of `s` in Helvetica-Bold at `size` pt (AFM metrics). */
export function measureHelveticaBold(s: string, size: number): number {
  return measure(s, size, BOLD_WIDTHS, BOLD_UNKNOWN_WIDTH)
}

/** The measurer of a box's text: Helvetica-Bold for bold boxes; italic does not change widths. */
export function measurer(bold: boolean | undefined): (s: string, size: number) => number {
  return bold ? measureHelveticaBold : measureHelvetica
}

/**
 * Where a wrapped line starts (pt from the inner left edge of a text area
 * `innerWidth` wide): left-aligned at 0, centred, or flush right. Measured
 * with Helvetica's (or, `bold`, Helvetica-Bold's) metrics, as the saved
 * appearance places it.
 */
export function lineX(line: string, fontSize: number, innerWidth: number, align: TextAlign, bold = false): number {
  if (align !== 'center' && align !== 'right') return 0
  const free = innerWidth - measurer(bold)(line, fontSize)
  return align === 'center' ? free / 2 : free
}

/** Splits a word wider than maxWidth into pieces that fit (at least one character each). */
function breakWord(word: string, fontSize: number, maxWidth: number, measure: (s: string, size: number) => number): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of word) {
    if (cur !== '' && measure(cur + ch, fontSize) > maxWidth) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  if (cur !== '') out.push(cur)
  return out
}

/**
 * Lines of `text` for a box whose text area is `maxWidth` wide, broken the way
 * the editor's textarea breaks (`white-space: pre-wrap`): hard breaks at
 * '\n'; soft breaks at spaces and after hyphens (the hyphen stays on the
 * first line); words longer than maxWidth broken by character. Spaces never
 * cause a break: at a wrap they hang on (and are trimmed from the end of) the
 * line, so the next line never starts with a space. Leading and inner spaces
 * are kept.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (s: string, size: number) => number,
): string[] {
  const lines: string[] = []
  const fits = (s: string) => measure(s, fontSize) <= maxWidth
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    // Odd entries are runs of spaces, even entries words (possibly empty).
    paragraph.split(/( +)/).forEach((token, i) => {
      if (i % 2 === 1) {
        line += token
        return
      }
      for (const part of token.split(/(?<=-)/)) {
        if (part === '' || fits(line + part)) {
          line += part
          continue
        }
        // Only spaces so far (paragraph indent): they stay with the part.
        if (line.trim() !== '') {
          lines.push(line.replace(/ +$/, ''))
          line = ''
        }
        if (fits(line + part)) {
          line += part
        } else {
          const pieces = breakWord(line + part, fontSize, maxWidth, measure)
          lines.push(...pieces.slice(0, -1))
          line = pieces.at(-1) ?? ''
        }
      }
    })
    lines.push(line)
  }
  return lines
}

/** Height of a box holding `lines` lines (at least one): full lines, a shorter last line (see LAST_LINE), padding. */
export function boxHeight(lines: number, fontSize: number): number {
  return (Math.max(1, lines) * LINE_HEIGHT - LAST_LINE_TRIM) * fontSize + 2 * TEXT_PADDING
}

/** Box with its top-left corner at `origin` (PDF, y up), `boxHeight(lines, fontSize)` high. */
export function boxRect(origin: Point, width: number, lines: number, fontSize: number): Rect {
  const h = boxHeight(lines, fontSize)
  return [origin[0], origin[1] - h, origin[0] + width, origin[1]]
}

/** Page rotation normalised to 0, 90, 180 or 270 (anything else counts as 0). */
export function normalizeRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const r = (((rotation ?? 0) % 360) + 360) % 360
  return r === 90 || r === 180 || r === 270 ? r : 0
}

/**
 * The PDF rect of a box that is `width` x `height` on screen with its
 * top-left (on screen) at `origin`, on a page with this /Rotate. The rect
 * stays axis-aligned in PDF space; for 90/270 its PDF width is the box height.
 */
export function pageBoxRect(origin: Point, width: number, height: number, rotation: number): Rect {
  const [x, y] = origin
  switch (normalizeRotation(rotation)) {
    case 90: // screen right = +y, down = +x
      return [x, y, x + height, y + width]
    case 180: // right = -x, down = +y
      return [x - width, y, x, y + height]
    case 270: // right = -y, down = -x
      return [x - height, y - width, x, y]
    default:
      return [x, y - height, x + width, y]
  }
}

/** Screen-aligned size of a box rect on a page with this /Rotate. */
export function frameSize(rect: Rect, rotation: number): { width: number; height: number } {
  const w = rect[2] - rect[0]
  const h = rect[3] - rect[1]
  const r = normalizeRotation(rotation)
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h }
}

/** PDF point at the box's top-left corner on screen (the `origin` of pageBoxRect). */
export function frameOrigin(rect: Rect, rotation: number): Point {
  switch (normalizeRotation(rotation)) {
    case 90:
      return [rect[0], rect[1]]
    case 180:
      return [rect[2], rect[1]]
    case 270:
      return [rect[2], rect[3]]
    default:
      return [rect[0], rect[3]]
  }
}

/** Width (pt) of a new box placed with a click: the placeholder fits on one line (in bold for a bold box). */
export function defaultBoxWidth(fontSize: number, bold = false): number {
  return Math.ceil(measurer(bold)(PLACEHOLDER, fontSize) + 2 * TEXT_PADDING)
}

/**
 * Narrowest box a drag can make (pt): one letter with the padding on both
 * sides. Sized for the widest letter ("W"), so any single character fits
 * without being broken.
 */
export function minBoxWidth(fontSize: number, bold = false): number {
  return measurer(bold)('W', fontSize) + 2 * TEXT_PADDING
}

/**
 * How far `to` lies right of `from` on screen (pt, negative = left), on a page
 * with this /Rotate: screen right is +x, +y, -x, -y for 0, 90, 180, 270.
 */
export function screenDx(from: Point, to: Point, rotation: number): number {
  switch (normalizeRotation(rotation)) {
    case 90:
      return to[1] - from[1]
    case 180:
      return from[0] - to[0]
    case 270:
      return from[1] - to[1]
    default:
      return to[0] - from[0]
  }
}

/** Lines of a text box: `text` wrapped to the box's screen width minus padding, with Helvetica (or Helvetica-Bold) metrics. */
export function layoutLines(text: string, fontSize: number, frameWidth: number, bold = false): string[] {
  return wrapText(text, fontSize, frameWidth - 2 * TEXT_PADDING, measurer(bold))
}
