import type { PDFPageProxy } from 'pdfjs-dist'
import type { PdfDoc } from './pdfEngine'
import { buildPageText, type PageText } from './search'

export type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>

const cache = new WeakMap<PDFPageProxy, Promise<TextContent>>()

/** The page's text content, fetched once per page (failed fetches are retried next time). */
export function textContentOf(page: PDFPageProxy): Promise<TextContent> {
  let p = cache.get(page)
  if (!p) {
    p = page.getTextContent()
    cache.set(page, p)
    p.catch(() => cache.delete(page))
  }
  return p
}

/** Whether any text item has a non-whitespace string (false for scanned pages). Cached per page. */
export async function pageHasText(page: PDFPageProxy): Promise<boolean> {
  const { items } = await textContentOf(page)
  return items.some((i) => 'str' in i && i.str.trim() !== '')
}

const texts = new WeakMap<PdfDoc, Map<number, Promise<PageText>>>()

/**
 * The searchable text of 0-based file page `source`, built on first use and
 * cached per document (failed builds are retried next time).
 */
export function pageTextOf(doc: PdfDoc, source: number): Promise<PageText> {
  let byPage = texts.get(doc)
  if (!byPage) texts.set(doc, (byPage = new Map()))
  let p = byPage.get(source)
  if (!p) {
    p = doc.getPage(source + 1).then(async (page) => buildPageText(await textContentOf(page)))
    byPage.set(source, p)
    p.catch(() => byPage.delete(source))
  }
  return p
}
