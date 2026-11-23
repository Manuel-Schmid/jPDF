import { afterEach, describe, expect, it } from 'vitest'
import { isPinch, trackCtrlKey } from '../../../src/core/viewer/ctrlKey'

let tracker: ReturnType<typeof trackCtrlKey> | null = null
afterEach(() => {
  tracker?.dispose()
  tracker = null
})

const key = (type: 'keydown' | 'keyup', ctrlKey: boolean) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: 'Control', ctrlKey, bubbles: true }))
const pointer = (type: 'pointermove' | 'pointerdown', ctrlKey: boolean) =>
  document.body.dispatchEvent(new PointerEvent(type, { ctrlKey, bubbles: true }))
const wheel = (ctrlKey: boolean) => new WheelEvent('wheel', { ctrlKey, deltaY: -10 })

describe('trackCtrlKey', () => {
  it('follows Ctrl down and up', () => {
    tracker = trackCtrlKey(window)
    expect(tracker.held()).toBe(false)
    key('keydown', true)
    expect(tracker.held()).toBe(true)
    // keyup of Control itself reports ctrlKey false.
    key('keyup', false)
    expect(tracker.held()).toBe(false)
  })

  it('reads the modifier from pointer events (Ctrl pressed while unfocused)', () => {
    tracker = trackCtrlKey(window)
    pointer('pointermove', true)
    expect(tracker.held()).toBe(true)
    pointer('pointerdown', false)
    expect(tracker.held()).toBe(false)
  })

  it('forgets Ctrl when the window loses focus (the keyup goes elsewhere)', () => {
    tracker = trackCtrlKey(window)
    key('keydown', true)
    window.dispatchEvent(new Event('blur'))
    expect(tracker.held()).toBe(false)
  })

  it('stops tracking once disposed', () => {
    const t = trackCtrlKey(window)
    t.dispose()
    key('keydown', true)
    expect(t.held()).toBe(false)
  })
})

describe('isPinch', () => {
  it('treats Ctrl+wheel without a held Ctrl key as a touchpad pinch', () => {
    expect(isPinch(wheel(true), false)).toBe(true)
  })

  it('treats Ctrl+wheel with Ctrl held as Ctrl + scroll, not a pinch', () => {
    expect(isPinch(wheel(true), true)).toBe(false)
  })

  it('ignores plain wheel scrolling', () => {
    expect(isPinch(wheel(false), false)).toBe(false)
    expect(isPinch(wheel(false), true)).toBe(false)
  })
})
