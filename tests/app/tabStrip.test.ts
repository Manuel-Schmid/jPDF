import { describe, expect, it } from 'vitest'
import { scrollToReveal, wheelToScroll } from '../../src/app/tabStrip'

describe('scrollToReveal', () => {
  it('keeps the position when the tab is already fully visible', () => {
    expect(scrollToReveal(100, 400, 150, 100)).toBe(100)
    expect(scrollToReveal(100, 400, 100, 400)).toBe(100)
  })

  it('scrolls left to a tab cut off on the left', () => {
    expect(scrollToReveal(300, 400, 250, 100)).toBe(250)
    expect(scrollToReveal(300, 400, 0, 100)).toBe(0)
  })

  it('scrolls right just enough for a tab cut off on the right', () => {
    expect(scrollToReveal(0, 400, 350, 100)).toBe(50)
    expect(scrollToReveal(0, 400, 900, 100)).toBe(600)
  })

  it('aligns a tab wider than the view to its left edge', () => {
    expect(scrollToReveal(0, 80, 200, 100)).toBe(200)
  })
})

describe('wheelToScroll', () => {
  it('turns a vertical wheel into horizontal scrolling', () => {
    expect(wheelToScroll(0, 120, 0)).toBe(120)
    expect(wheelToScroll(0, -120, 0)).toBe(-120)
  })

  it('converts line-based deltas to pixels', () => {
    expect(wheelToScroll(0, 3, 1)).toBe(120)
  })

  it('leaves horizontal swipes and empty events alone', () => {
    expect(wheelToScroll(50, 10, 0)).toBe(0)
    expect(wheelToScroll(0, 0, 0)).toBe(0)
  })
})
