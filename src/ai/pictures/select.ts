import { AnnotationMode, OPS, type PDFPageProxy } from 'pdfjs-dist'

/**
 * Which pages of an explanation request get a picture of the page. Text alone
 * explains most lecture pages; a picture helps where the text misses what the
 * page shows: little or no text (scans, title slides with a figure), a large
 * image (screenshots, photos), or many drawn paths (diagrams, charts). Each
 * picture uses more of the user's plan, so plain text pages go without.
 *
 * Loaded only by the lazily imported generation code: never import this from
 * an eagerly loaded module.
 */

/** Fewer characters (after cleanPageText) than this: the text says too little alone. */
export const LITTLE_TEXT = 200
/** The largest single image covers at least this share of the page area. */
export const IMAGE_COVERAGE = 0.08
/** At least this many filled or stroked paths: a diagram or chart. */
export const DIAGRAM_PATHS = 25
/** Fewer filled or stroked paths than this (and no text, no image): an empty page. */
export const EMPTY_PATHS = 3

/** What a page draws, from its pdf.js operator list. */
export interface PageShape {
  /** The largest single image's share of the page area, 0–1. */
  imageCoverage: number
  /** How many paths are filled or stroked (clip-only and discarded paths don't count). */
  paths: number
}

export type PageKind = 'empty' | 'text' | 'picture'

/** Ops that paint an image into the unit square of the current transform. */
const IMAGE_OPS = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintImageXObjectRepeat',
  'paintInlineImageXObjectGroup',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
  'paintSolidColorImageMask',
]

/** Ops that fill or stroke the current path (endPath discards it). */
const PAINT_OPS = [
  'fill',
  'eoFill',
  'stroke',
  'fillStroke',
  'eoFillStroke',
  'closeStroke',
  'closeFillStroke',
  'closeEOFillStroke',
]

/** The codes of the named ops this pdf.js build has (an op it lacks is skipped). */
function codes(ops: Record<string, number>, names: readonly string[]): Set<number> {
  const out = new Set<number>()
  for (const n of names) if (typeof ops[n] === 'number') out.add(ops[n])
  return out
}

/** |a·d − b·c| of a transform's [a, b, c, d, e, f]; 1 (no change) for anything malformed. */
function areaScale(m: unknown): number {
  if (!Array.isArray(m) && !ArrayBuffer.isView(m)) return 1
  const [a, b, c, d] = m as ArrayLike<number> & number[]
  const det = Math.abs(a * d - b * c)
  return Number.isFinite(det) ? det : 1
}

/**
 * The shape of a page from its operator list (`fnArray`/`argsArray` as
 * pdf.js's getOperatorList returns them, `ops` its OPS table), for a page of
 * `pageWidth` × `pageHeight` user-space units (unrotated).
 *
 * Images: an image op paints the unit square of the current transform, so
 * its area is the transform's determinant |a·d − b·c|. Areas multiply under
 * composition (det(A·B) = det A · det B), so the transform is tracked as that
 * one number: save/restore push and pop it, transform multiplies it in, and a
 * form XObject's begin/end does both with its /Matrix.
 *
 * Paths: pdf.js 5+ reports the paint op inside constructPath's args
 * (`[paintOp, [pathData], minMax]`, with `endPath` for a discarded or
 * clip-only path); older versions put it in a separate op after the
 * constructPath, so a path also counts when a paint op follows before the
 * next constructPath.
 */
export function analyzeOperators(
  fnArray: readonly number[],
  argsArray: readonly unknown[],
  ops: Record<string, number>,
  pageWidth: number,
  pageHeight: number,
): PageShape {
  const images = codes(ops, IMAGE_OPS)
  const paints = codes(ops, PAINT_OPS)
  const pageArea = Math.abs(pageWidth * pageHeight)
  const stack: number[] = []
  let scale = 1
  let largest = 0
  let paths = 0
  // An older-shape constructPath waiting for its paint op.
  let pending = false

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] as unknown[] | null | undefined
    if (fn === ops.save) stack.push(scale)
    else if (fn === ops.restore) scale = stack.pop() ?? scale
    else if (fn === ops.transform) scale *= areaScale(args)
    else if (fn === ops.paintFormXObjectBegin) {
      // pdf.js draws a form as save + transform(matrix); a missing matrix is identity.
      stack.push(scale)
      scale *= areaScale(args?.[0])
    } else if (fn === ops.paintFormXObjectEnd) scale = stack.pop() ?? scale
    else if (images.has(fn)) largest = Math.max(largest, scale)
    else if (fn === ops.constructPath) {
      const paint = args?.[0]
      if (typeof paint === 'number') {
        pending = false
        if (paints.has(paint)) paths++
      } else pending = true
    } else if (pending && paints.has(fn)) {
      paths++
      pending = false
    } else if (fn === ops.endPath) pending = false
  }

  const imageCoverage = pageArea > 0 ? Math.min(1, largest / pageArea) : 0
  return { imageCoverage, paths }
}

/**
 * Whether a page is sent with a picture. `textLength` is the page's text
 * length after cleanPageText. An empty page (no text, no image, next to no
 * drawing) never gets one, in either mode. `'all'` pictures every other
 * page; `'useful'` only those whose text misses what they show.
 */
export function classifyPage(mode: 'useful' | 'all', textLength: number, shape: PageShape): PageKind {
  if (textLength === 0 && shape.imageCoverage === 0 && shape.paths < EMPTY_PATHS) return 'empty'
  if (mode === 'all') return 'picture'
  const useful =
    textLength < LITTLE_TEXT || shape.imageCoverage >= IMAGE_COVERAGE || shape.paths >= DIAGRAM_PATHS
  return useful ? 'picture' : 'text'
}

/**
 * The shape of a pdf.js page, from its operator list without annotations
 * (pictures show the page without them too). The list is freed afterwards:
 * a long request analyzes many pages, most of which are never rendered.
 */
export async function pageShape(page: PDFPageProxy): Promise<PageShape> {
  const list = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE })
  const { width, height } = page.getViewport({ scale: 1, rotation: 0 })
  const shape = analyzeOperators(list.fnArray, list.argsArray, OPS as unknown as Record<string, number>, width, height)
  page.cleanup()
  return shape
}
