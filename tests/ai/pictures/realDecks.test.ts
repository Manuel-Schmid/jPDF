// @vitest-environment node
/**
 * Checks the picture selection thresholds on real lecture decks, by eye:
 * prints one row per page (text length, largest image's share of the page,
 * filled/stroked paths, kind). Skipped unless JULIEPDF_DECKS names the PDFs
 * (semicolon-separated); the decks stay outside the repository.
 *
 *   $env:JULIEPDF_DECKS = 'C:\path\a.pdf;C:\path\b.pdf'; npx vitest run tests/ai/pictures/realDecks.test.ts --silent=false
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { classifyPage, pageShape } from '../../../src/ai/pictures/select'
import { cleanPageText } from '../../../src/ai/prompt'

// select.ts imports the browser build; Node needs the legacy one (same OPS).
vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

const decks = (process.env.JULIEPDF_DECKS ?? '')
  .split(';')
  .map((p) => p.trim())
  .filter(Boolean)

describe.skipIf(decks.length === 0)('picture selection on real decks', () => {
  for (const path of decks) {
    it(`classifies ${basename(path)}`, { timeout: 120_000 }, async () => {
      const task = getDocument({
        data: new Uint8Array(readFileSync(path)),
        isEvalSupported: false,
        verbosity: 0,
        standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
      })
      const doc = await task.promise
      const rows = []
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const { items } = await page.getTextContent()
          const text = items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join('').trim()
          const textLen = cleanPageText(text).length
          const shape = await pageShape(page as never)
          rows.push({
            page: n,
            textLen,
            imageCoverage: shape.imageCoverage.toFixed(2),
            paths: shape.paths,
            kind: classifyPage('useful', textLen, shape),
          })
        }
      } finally {
        await task.destroy()
      }
      console.log(basename(path))
      console.table(rows)
      expect(rows.length).toBeGreaterThan(0)
    })
  }
})
