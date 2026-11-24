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
  const unit = pdfPage.getViewport({ scale: 1, rotation })
  const viewport = pdfPage.getViewport({ scale: LONG_EDGE / Math.max(unit.width, unit.height), rotation })
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)))
  try {
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
    canvas.width = 0
    canvas.height = 0
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
