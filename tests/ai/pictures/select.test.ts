import { AnnotationMode, OPS, type PDFPageProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import {
  analyzeOperators,
  classifyPage,
  DIAGRAM_PATHS,
  LITTLE_TEXT,
  pageShape,
  type PageShape,
} from '../../../src/ai/pictures/select'

const W = 600
const H = 800
const ops = OPS as unknown as Record<string, number>

/** A tiny operator list builder in pdf.js's real shape (fnArray + argsArray). */
function list() {
  const fn: number[] = []
  const args: unknown[] = []
  const b = {
    op(code: number, a: unknown = null) {
      fn.push(code)
      args.push(a)
      return b
    },
    save: () => b.op(OPS.save),
    restore: () => b.op(OPS.restore),
    transform: (...m: number[]) => b.op(OPS.transform, m),
    image: () => b.op(OPS.paintImageXObject, ['img_p0_1', 1, 1]),
    /** pdf.js 5+/6: the paint op travels inside constructPath's args. */
    path: (paint: number) =>
      b.op(OPS.constructPath, [paint, [new Float32Array([0, 0, 0, 1, 10, 10])], new Float32Array([0, 0, 10, 10])]),
    shape: (): PageShape => analyzeOperators(fn, args, ops, W, H),
  }
  return b
}

/** A uniform scale whose unit square covers `share` of the page. */
const scaleFor = (share: number) => Math.sqrt(share * W * H)

describe('analyzeOperators', () => {
  it('small logo stays below coverage', () => {
    const s = scaleFor(0.05)
    const shape = list().save().transform(s, 0, 0, s, 20, 20).image().restore().shape()
    expect(shape.imageCoverage).toBeCloseTo(0.05)
    expect(classifyPage('useful', 500, shape)).toBe('text')
  })

  it('large image counts', () => {
    const s = scaleFor(0.3)
    const shape = list().transform(s, 0, 0, s, 0, 0).image().shape()
    expect(shape.imageCoverage).toBeCloseTo(0.3)
    expect(classifyPage('useful', 500, shape)).toBe('picture')
  })

  it('takes the largest single image, not the sum', () => {
    const s = scaleFor(0.05)
    const shape = list().transform(s, 0, 0, s, 0, 0).image().image().image().shape()
    expect(shape.imageCoverage).toBeCloseTo(0.05)
  })

  it('nested transforms and form xobject matrix multiply', () => {
    const s = 200
    const shape = list()
      .save()
      .transform(2, 0, 0, 2, 0, 0)
      .op(OPS.paintFormXObjectBegin, [[0.5, 0, 0, 0.5, 10, 10], [0, 0, 100, 100]])
      .transform(s, 0, 0, s, 0, 0)
      .image()
      .op(OPS.paintFormXObjectEnd)
      .restore()
      .shape()
    expect(shape.imageCoverage).toBeCloseTo((s * s) / (W * H))
  })

  it('the form xobject matrix is dropped at its end', () => {
    const shape = list()
      .op(OPS.paintFormXObjectBegin, [[10, 0, 0, 10, 0, 0], [0, 0, 1, 1]])
      .op(OPS.paintFormXObjectEnd)
      .transform(20, 0, 0, 20, 0, 0)
      .image()
      .shape()
    expect(shape.imageCoverage).toBeCloseTo(400 / (W * H))
  })

  it('a rotated or skewed matrix uses the determinant', () => {
    // 90° rotation scaled by 100: |a·d − b·c| = 100².
    const shape = list().transform(0, 100, -100, 0, 0, 0).image().shape()
    expect(shape.imageCoverage).toBeCloseTo(10000 / (W * H))
  })

  it('restore pops the transform', () => {
    const shape = list()
      .save()
      .transform(300, 0, 0, 300, 0, 0)
      .restore()
      .transform(10, 0, 0, 10, 0, 0)
      .image()
      .shape()
    expect(shape.imageCoverage).toBeCloseTo(100 / (W * H))
  })

  it('other image ops count too', () => {
    const s = scaleFor(0.2)
    for (const name of ['paintInlineImageXObject', 'paintImageMaskXObject', 'paintSolidColorImageMask']) {
      const shape = list().transform(s, 0, 0, s, 0, 0).op(ops[name], []).shape()
      expect(shape.imageCoverage, name).toBeCloseTo(0.2)
    }
  })

  it('a folded image repeat uses its scale args', () => {
    // pdf.js's optimizer: [objId, scaleX, scaleY, positions] under a 2x page transform.
    const shape = list()
      .transform(2, 0, 0, 2, 0, 0)
      .op(OPS.paintImageXObjectRepeat, ['img_p0_1', 100, -150, new Float32Array([0, 0, 200, 0, 400, 0])])
      .shape()
    expect(shape.imageCoverage).toBeCloseTo((4 * 100 * 150) / (W * H))
  })

  it('a folded image mask repeat uses its matrix args', () => {
    // [img, a, b, c, d, positions]
    const shape = list()
      .op(OPS.paintImageMaskXObjectRepeat, [{ width: 1, height: 1 }, 120, 0, 0, 200, new Float32Array([0, 0, 50, 50, 90, 90])])
      .shape()
    expect(shape.imageCoverage).toBeCloseTo((120 * 200) / (W * H))
  })

  it('an image mask group takes its largest image transform', () => {
    // [images], each with its own transform.
    const images = [
      { data: new Uint8Array(1), width: 1, height: 1, transform: [10, 0, 0, 10, 0, 0] },
      { data: new Uint8Array(1), width: 1, height: 1, transform: [0, 300, -200, 0, 50, 50] },
    ]
    const shape = list().transform(0.5, 0, 0, 0.5, 0, 0).op(OPS.paintImageMaskXObjectGroup, [images]).shape()
    expect(shape.imageCoverage).toBeCloseTo((0.25 * 300 * 200) / (W * H))
  })

  it('an inline image group takes its largest map transform', () => {
    // [imgData, map], each map entry with the image's transform.
    const map = [
      { transform: [250, 0, 0, 250, 0, 0], x: 1, y: 1, w: 4, h: 4 },
      { transform: [30, 0, 0, 30, 0, 0], x: 7, y: 1, w: 4, h: 4 },
    ]
    const shape = list().op(OPS.paintInlineImageXObjectGroup, [{ width: 12, height: 6 }, map]).shape()
    expect(shape.imageCoverage).toBeCloseTo((250 * 250) / (W * H))
  })

  it('coverage is capped at the whole page', () => {
    const shape = list().transform(5000, 0, 0, 5000, 0, 0).image().shape()
    expect(shape.imageCoverage).toBe(1)
  })

  it('many filled paths are a diagram', () => {
    const many = list()
    for (let i = 0; i < DIAGRAM_PATHS; i++) many.path(i % 2 ? OPS.fill : OPS.stroke)
    expect(many.shape().paths).toBe(DIAGRAM_PATHS)
    expect(classifyPage('useful', 500, many.shape())).toBe('picture')

    const fewer = list()
    for (let i = 0; i < DIAGRAM_PATHS - 1; i++) fewer.path(OPS.fillStroke)
    expect(classifyPage('useful', 500, fewer.shape())).toBe('text')
  })

  it("unfilled paths don't count", () => {
    const b = list()
    for (let i = 0; i < 30; i++) b.path(OPS.endPath)
    expect(b.shape().paths).toBe(0)
  })

  it('older shape: a constructPath followed by a paint op counts once', () => {
    const shape = list()
      .op(OPS.constructPath, [[OPS.moveTo, OPS.lineTo], [0, 0, 10, 10], [0, 0, 10, 10]])
      .op(OPS.fill)
      .op(OPS.constructPath, [[OPS.rectangle], [0, 0, 10, 10], [0, 0, 10, 10]])
      .op(OPS.endPath)
      .op(OPS.fill) // a stray paint op with no path pending
      .shape()
    expect(shape.paths).toBe(1)
  })
})

describe('classifyPage', () => {
  const plain: PageShape = { imageCoverage: 0, paths: 0 }

  it('little text gets a picture', () => {
    expect(classifyPage('useful', LITTLE_TEXT - 1, plain)).toBe('picture')
    expect(classifyPage('useful', LITTLE_TEXT, plain)).toBe('text')
  })

  it('empty page', () => {
    const shape: PageShape = { imageCoverage: 0, paths: 2 }
    expect(classifyPage('useful', 0, shape)).toBe('empty')
    expect(classifyPage('all', 0, shape)).toBe('empty')
    expect(classifyPage('useful', 0, { imageCoverage: 0, paths: 3 })).toBe('picture')
    expect(classifyPage('useful', 0, { imageCoverage: 0.01, paths: 0 })).toBe('picture')
  })

  it('all mode pictures every non-empty page', () => {
    expect(classifyPage('all', 5000, plain)).toBe('picture')
    expect(classifyPage('all', 1, plain)).toBe('picture')
  })
})

describe('pageShape', () => {
  it('analyzes the operator list without annotations on the unrotated page, then frees it', async () => {
    const page = {
      rotate: 90,
      getOperatorList: vi.fn(async (_o: unknown) => ({
        fnArray: [OPS.transform, OPS.paintImageXObject],
        argsArray: [[300, 0, 0, 400, 0, 0], ['img', 1, 1]],
      })),
      getViewport: vi.fn(({ rotation }: { scale: number; rotation: number }) =>
        rotation % 180 ? { width: 800, height: 600 } : { width: 600, height: 800 },
      ),
      cleanup: vi.fn(() => true),
    }
    const shape = await pageShape(page as unknown as PDFPageProxy)
    expect(page.getOperatorList).toHaveBeenCalledWith({ annotationMode: AnnotationMode.DISABLE })
    expect(page.getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 0 })
    expect(shape).toEqual({ imageCoverage: 0.25, paths: 0 })
    expect(page.cleanup).toHaveBeenCalled()
  })

  it('frees the page when the operator list fails', async () => {
    const page = {
      getOperatorList: vi.fn(async () => {
        throw new Error('worker gone')
      }),
      getViewport: vi.fn(),
      cleanup: vi.fn(() => true),
    }
    await expect(pageShape(page as unknown as PDFPageProxy)).rejects.toThrow('worker gone')
    expect(page.cleanup).toHaveBeenCalled()
  })
})
