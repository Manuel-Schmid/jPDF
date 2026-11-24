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
})
