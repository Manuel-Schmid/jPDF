import { describe, expect, it } from 'vitest'
import { TOOLBAR_POSITIONS } from '../../src/core/settings/preferences'
import { flyoutPosition, shellLayout, toolbarAxis, towardPage } from '../../src/toolbar/placement'

/** The grid's area names, row by row. */
const grid = (areas: string) => areas.match(/"[^"]*"/g)!.map((row) => row.slice(1, -1).split(' '))
/** The tracks of a grid-template-rows/columns value (`minmax(0, 1fr)` is one). */
const tracks = (v: string) => v.match(/[^\s(]+(\([^)]*\))?/g)!

describe('shellLayout', () => {
  it('right (the default): the strip in the last column between title and status bar', () => {
    const l = shellLayout('right')
    expect(grid(l.areas)).toEqual([['title', 'title'], ['viewer', 'tools'], ['status', 'status']])
    expect(l.columns).toBe('1fr var(--toolstrip-w)')
    expect(l.rows).toBe('var(--titlebar-h) 1fr var(--statusbar-h)')
  })

  it('left: the strip in the first column', () => {
    const l = shellLayout('left')
    expect(grid(l.areas)).toEqual([['title', 'title'], ['tools', 'viewer'], ['status', 'status']])
    expect(l.columns).toBe('var(--toolstrip-w) 1fr')
  })

  it('top: a row between the title bar and the page area', () => {
    const l = shellLayout('top')
    expect(grid(l.areas)).toEqual([['title'], ['tools'], ['viewer'], ['status']])
    expect(l.rows).toBe('var(--titlebar-h) var(--toolstrip-w) 1fr var(--statusbar-h)')
    // May shrink below the strip's content, so a narrow window scrolls the strip.
    expect(l.columns).toBe('minmax(0, 1fr)')
  })

  it('bottom: a row just above the status bar', () => {
    const l = shellLayout('bottom')
    expect(grid(l.areas)).toEqual([['title'], ['viewer'], ['tools'], ['status']])
    expect(l.rows).toBe('var(--titlebar-h) 1fr var(--toolstrip-w) var(--statusbar-h)')
    expect(l.columns).toBe('minmax(0, 1fr)')
  })

  it('every position has one track per grid row and column, and all four areas', () => {
    for (const p of TOOLBAR_POSITIONS) {
      const l = shellLayout(p)
      const rows = grid(l.areas)
      expect(tracks(l.rows)).toHaveLength(rows.length)
      expect(tracks(l.columns)).toHaveLength(rows[0].length)
      expect(new Set(rows.flat())).toEqual(new Set(['title', 'tools', 'viewer', 'status']))
    }
  })

  it('fullscreen shows only the viewer; the builder drops the toolbar, in every position', () => {
    for (const p of TOOLBAR_POSITIONS) {
      expect(shellLayout(p, { fullscreen: true })).toEqual({ areas: '"viewer"', rows: '1fr', columns: '1fr' })
      expect(grid(shellLayout(p, { building: true }).areas)).toEqual([['title'], ['viewer'], ['status']])
    }
  })
})

describe('axis and side', () => {
  it('left/right are vertical, top/bottom horizontal', () => {
    expect(TOOLBAR_POSITIONS.map(toolbarAxis)).toEqual(['vertical', 'vertical', 'horizontal', 'horizontal'])
  })

  it('popups open toward the page area', () => {
    expect(TOOLBAR_POSITIONS.map(towardPage)).toEqual(['left', 'right', 'bottom', 'top'])
  })
})

describe('flyoutPosition', () => {
  const VW = 1000
  const VH = 800
  const W = 256
  const H = 300
  const rect = (left: number, top: number, size = 40) => ({ left, top, right: left + size, bottom: top + size })

  it('right toolbar: left of the button, top-aligned', () => {
    expect(flyoutPosition(rect(954, 100), W, H, VW, VH, 'left')).toEqual({ left: 954 - 8 - W, top: 100 })
  })

  it('left toolbar: right of the button, top-aligned', () => {
    expect(flyoutPosition(rect(6, 100), W, H, VW, VH, 'right')).toEqual({ left: 54, top: 100 })
  })

  it('top toolbar: below the button, left-aligned', () => {
    expect(flyoutPosition(rect(200, 46), W, H, VW, VH, 'bottom')).toEqual({ left: 200, top: 94 })
  })

  it('bottom toolbar: above the button, left-aligned', () => {
    expect(flyoutPosition(rect(200, 720), W, H, VW, VH, 'top')).toEqual({ left: 200, top: 720 - 8 - H })
  })

  it('stays inside the window near the edges', () => {
    // A low button on a side strip: pushed up to the bottom margin.
    expect(flyoutPosition(rect(954, 700), W, H, VW, VH, 'left').top).toBe(VH - H - 8)
    expect(flyoutPosition(rect(6, 700), W, H, VW, VH, 'right').top).toBe(VH - H - 8)
    // The last button of a top/bottom strip: pushed left to the right margin.
    expect(flyoutPosition(rect(950, 46), W, H, VW, VH, 'bottom').left).toBe(VW - W - 8)
    expect(flyoutPosition(rect(950, 720), W, H, VW, VH, 'top').left).toBe(VW - W - 8)
    // A window too small for it: never past the top-left margin.
    expect(flyoutPosition(rect(100, 100), W, H, 200, 200, 'left')).toEqual({ left: 8, top: 8 })
    expect(flyoutPosition(rect(100, 150), W, H, 200, 200, 'top')).toEqual({ left: 8, top: 8 })
  })
})
