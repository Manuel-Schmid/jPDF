import { AnnotationMode } from 'pdfjs-dist'
import { normalizeRotation } from '../../core/geometry/textLayout'
import type { PageEntry } from '../../core/session/pages'
import type { PdfDoc } from '../../core/viewer/pdfEngine'

/**
 * Pictures of pages for an explanation request: the original page as the
 * user sees it turned, without any annotations (the explanation is about the
 * page, not the user's marks on it).
 *
 * Loaded only by the lazily imported generation code: never import this from
 * an eagerly loaded module.
 */

/** One page picture, ready to send to the CLI. */
export interface PagePicture {
  /** The page number the request uses for this page. */
  page: number
  mediaType: 'image/jpeg'
  /** The JPEG bytes, base64. */
  data: string
}

/** Longest side of a picture in pixels: diagrams and small print stay legible. */
const LONG_EDGE = 1280
/** JPEG quality: text stays sharp at a fraction of PNG's size. */
const QUALITY = 0.8

/**
 * Renders the file page of `entry` (a source entry) into a JPEG picture
 * numbered `page`, turned by the page's own /Rotate plus the page list's
 * extra rotation, at LONG_EDGE pixels on its longest side. Renders off screen
 * on an OffscreenCanvas, so nothing on the viewer's paths is touched.
 */
export async function renderPicture(doc: PdfDoc, entry: PageEntry, page: number): Promise<PagePicture> {
  if (entry.kind !== 'source') throw new Error('Only file pages have a picture.')
  const pdfPage = await doc.getPage(entry.source + 1)
  const rotation = normalizeRotation(pdfPage.rotate + entry.rotate)
  let canvas: OffscreenCanvas | null = null
  try {
    const unit = pdfPage.getViewport({ scale: 1, rotation })
    const viewport = pdfPage.getViewport({ scale: LONG_EDGE / Math.max(unit.width, unit.height), rotation })
    canvas = new OffscreenCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)))
    // pdf.js only asks the canvas for a 2D context, which an OffscreenCanvas
    // provides; its types just name HTMLCanvasElement.
    await pdfPage.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
    }).promise
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
    return { page, mediaType: 'image/jpeg', data: await base64(blob) }
  } finally {
    // Free the pixels and the page's operator list right away: a request
    // renders up to dozens of pages in a row.
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    if (!doc.destroyed) pdfPage.cleanup()
  }
}

/** Most an area is enlarged: a small formula is rendered sharper, not blown up without end. */
const MAX_AREA_SCALE = 4
/** Room around a selected area (of its size), so its edges are not cut off. */
const AREA_MARGIN = 0.06

/**
 * Where to render a selected area: `box` (viewport px of the page at scale
 * 1, in any corner order) grown by a small margin and kept on the
 * `pageW` x `pageH` page, and the scale that gives it LONG_EDGE pixels on its
 * longest side (at most MAX_AREA_SCALE).
 */
export function areaCrop(
  box: readonly [number, number, number, number],
  pageW: number,
  pageH: number,
): { x: number; y: number; w: number; h: number; scale: number } {
  const [x1, x2] = box[0] <= box[2] ? [box[0], box[2]] : [box[2], box[0]]
  const [y1, y2] = box[1] <= box[3] ? [box[1], box[3]] : [box[3], box[1]]
  const m = Math.max(x2 - x1, y2 - y1) * AREA_MARGIN
  const x = Math.max(0, x1 - m)
  const y = Math.max(0, y1 - m)
  const w = Math.max(1, Math.min(pageW, x2 + m) - x)
  const h = Math.max(1, Math.min(pageH, y2 + m) - y)
  return { x, y, w, h, scale: Math.min(MAX_AREA_SCALE, LONG_EDGE / Math.max(w, h)) }
}

/**
 * A picture of the area `rect` (PDF user space) of the file page of
 * `entry`, numbered `page`, turned as the user sees it: only that part of
 * the page is rendered (pdf.js viewport offsets), enlarged so small print
 * stays legible. Off screen, like renderPicture.
 */
export async function renderArea(doc: PdfDoc, entry: PageEntry, rect: readonly [number, number, number, number], page: number): Promise<PagePicture> {
  if (entry.kind !== 'source') throw new Error('Only file pages have a picture.')
  const pdfPage = await doc.getPage(entry.source + 1)
  const rotation = normalizeRotation(pdfPage.rotate + entry.rotate)
  let canvas: OffscreenCanvas | null = null
  try {
    const unit = pdfPage.getViewport({ scale: 1, rotation })
    const [ax, ay] = unit.convertToViewportPoint(rect[0], rect[1])
    const [bx, by] = unit.convertToViewportPoint(rect[2], rect[3])
    const crop = areaCrop([ax, ay, bx, by], unit.width, unit.height)
    const viewport = pdfPage.getViewport({
      scale: crop.scale,
      rotation,
      offsetX: -crop.x * crop.scale,
      offsetY: -crop.y * crop.scale,
    })
    canvas = new OffscreenCanvas(Math.max(1, Math.round(crop.w * crop.scale)), Math.max(1, Math.round(crop.h * crop.scale)))
    await pdfPage.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
    }).promise
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
    return { page, mediaType: 'image/jpeg', data: await base64(blob) }
  } finally {
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    if (!doc.destroyed) pdfPage.cleanup()
  }
}

/** The bytes of `blob` as base64 (a data URL's payload, without its prefix). */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the page picture.'))
    reader.readAsDataURL(blob)
  })
}
