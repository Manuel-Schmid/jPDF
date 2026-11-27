import { afterEach, describe, expect, it, vi } from 'vitest'
import { generationRuns } from '../../../src/ai/runs.svelte'
import type { LassoPath, PagePointerEvent, ToolContext } from '../../../src/core/registry/tools'
import type { Point } from '../../../src/core/session/model'
import { defaultPreferences } from '../../../src/core/settings/preferences'
import { createExplainHandler, explainTool } from '../../../src/tools/explain'

const ev = (pdf: Point, page = 0): PagePointerEvent =>
  ({ page, pdf, screen: [0, 0], vp: {} as never, native: {} as PointerEvent, toPdf: () => pdf }) as PagePointerEvent

function setup() {
  let lasso: LassoPath | null = null
  const ctx = { session: { id: 's' }, lasso: { set: (l: LassoPath | null) => void (lasso = l) } } as unknown as ToolContext
  const prefs = { ...defaultPreferences(), aiEnabled: true }
  const explain = vi.fn()
  return { h: createExplainHandler(ctx, () => prefs, explain), explain, lasso: () => lasso, ctx, prefs }
}

afterEach(() => generationRuns.clear('s'))

describe('AI Explain tool', () => {
  it('is an AI tool with the A shortcut and no options', () => {
    expect(explainTool).toMatchObject({ type: 'explain', displayName: 'AI Explain', shortcut: 'A', requiresAi: true, Options: null })
    expect(explainTool.description).toBe('Explain part of a page with AI')
  })

  it('draws the box while dragging and explains it on release, without touching annotations', () => {
    const t = setup()
    t.h.onPointerDown!(ev([10, 20]))
    t.h.onPointerMove!(ev([60, 80]))
    expect(t.lasso()?.points).toEqual([[10, 20], [60, 20], [60, 80], [10, 80]])
    t.h.onPointerUp!(ev([60, 80]))
    expect(t.lasso()).toBeNull()
    expect(t.explain).toHaveBeenCalledWith(t.ctx.session, t.prefs, { page: 0, rect: [10, 20, 60, 80] })
  })

  it('a box dragged backwards is the same box; a click or a slip explains nothing', () => {
    const t = setup()
    t.h.onPointerDown!(ev([60, 80]))
    t.h.onPointerUp!(ev([10, 20]))
    expect(t.explain).toHaveBeenLastCalledWith(t.ctx.session, t.prefs, { page: 0, rect: [10, 20, 60, 80] })
    t.h.onPointerDown!(ev([10, 20]))
    t.h.onPointerUp!(ev([13, 100]))
    expect(t.explain).toHaveBeenCalledOnce()
  })

  it('stays on the page it started on, and waits while an explanation runs', () => {
    const t = setup()
    t.h.onPointerDown!(ev([10, 20]))
    t.h.onPointerMove!(ev([500, 500], 1))
    t.h.onPointerUp!(ev([500, 500], 1))
    // Ended on another page: the box is where it was on page 0 (too small here).
    expect(t.explain).not.toHaveBeenCalled()

    generationRuns.update('s', { status: 'running' })
    t.h.onPointerDown!(ev([10, 20]))
    t.h.onPointerUp!(ev([60, 80]))
    expect(t.explain).not.toHaveBeenCalled()
  })

  it('cancel or a tool change drops the box', () => {
    const t = setup()
    t.h.onPointerDown!(ev([10, 20]))
    t.h.onPointerCancel!(ev([10, 20]))
    expect(t.lasso()).toBeNull()
    t.h.onPointerUp!(ev([60, 80]))
    expect(t.explain).not.toHaveBeenCalled()
  })
})
