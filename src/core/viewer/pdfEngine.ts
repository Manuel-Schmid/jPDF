import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

let sharedWorker: PDFWorker | null = null

/**
 * The pdf.js worker all documents share. Starting a worker (loading and
 * compiling its 1.3 MB script) costs tens of milliseconds, so it is started
 * once (see warmUpPdfWorker) instead of per opened file.
 */
function pdfWorker(): PDFWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new PDFWorker()
  return sharedWorker
}

/**
 * Starts the shared pdf.js worker ahead of the first open. A failure is only
 * logged: the failed worker is dropped and loadPdf starts a new one.
 */
export function warmUpPdfWorker(): void {
  let worker: PDFWorker
  try {
    worker = pdfWorker()
  } catch (e) {
    console.error('pdf.js worker warm-up failed', e)
    sharedWorker = null
    return
  }
  worker.promise.catch((e: unknown) => {
    console.error('pdf.js worker warm-up failed', e)
    if (sharedWorker === worker) sharedWorker = null
    worker.destroy()
  })
}

export interface PdfDoc {
  numPages: number
  /** True once destroy() was called; renders failing afterwards are expected. */
  readonly destroyed: boolean
  /** `i` is the 1-based page number. */
  getPage(i: number): Promise<PDFPageProxy>
  /**
   * Stops pdf.js from drawing these annotations (pdf.js ids, e.g. "12R"):
   * JuliePDF draws its own annotations in the overlay. Takes effect for pages
   * rendered with `annotationMode: AnnotationMode.ENABLE_STORAGE`.
   */
  suppressAnnotations(refs: Iterable<string>): void
  /** The explicit destination of a named destination (links); null if there is none. */
  getDestination(id: string): Promise<unknown[] | null>
  /** 0-based index of the page a destination's page reference points to. */
  getPageIndex(ref: { num: number; gen: number }): Promise<number>
  destroy(): Promise<void>
}

class PdfJsDoc implements PdfDoc {
  destroyed = false

  constructor(
    private readonly task: PDFDocumentLoadingTask,
    private readonly proxy: PDFDocumentProxy,
  ) {}

  get numPages(): number {
    return this.proxy.numPages
  }

  getPage(i: number): Promise<PDFPageProxy> {
    return this.proxy.getPage(i)
  }

  suppressAnnotations(refs: Iterable<string>): void {
    // The worker skips annotations whose storage entry says noView
    // (Annotation.mustBeViewed); see tests/core/viewer/annotationSuppression.test.ts.
    for (const ref of refs) this.proxy.annotationStorage.setValue(ref, { noView: true })
  }

  getDestination(id: string): Promise<unknown[] | null> {
    return this.proxy.getDestination(id)
  }

  getPageIndex(ref: { num: number; gen: number }): Promise<number> {
    return this.proxy.getPageIndex(ref)
  }

  destroy(): Promise<void> {
    this.destroyed = true
    // Tears down the document in the shared worker.
    return this.task.destroy()
  }
}

/**
 * Loads a PDF. Throws `{code:'Encrypted'|'InvalidPdf', message}` on failure.
 * Takes ownership of `data`: pdf.js transfers (detaches) it to its worker,
 * which saves copying a whole file on the way to the first page.
 */
export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const task = getDocument({
    data: new Uint8Array(data),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    iccUrl: '/pdfjs/iccs/',
    wasmUrl: '/pdfjs/wasm/',
    // GPU canvases: about twice as fast to paint a full page at high DPI as
    // pdf.js' default software canvases, and less memory in the GPU process
    // (PageView re-renders a page whose canvas lost its GPU context).
    enableHWA: true,
    // Not owned by the loading task: destroying a document keeps the worker.
    worker: pdfWorker(),
  })
  try {
    return new PdfJsDoc(task, await task.promise)
  } catch (e) {
    void task.destroy()
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof PasswordException) throw { code: 'Encrypted', message }
    throw { code: 'InvalidPdf', message }
  }
}
