import { afterEach, describe, expect, it } from 'vitest'
import { ctrlWheelAction, trackCtrlKey } from '../../../src/core/viewer/ctrlKey'

let tracker: ReturnType<typeof trackCtrlKey> | null = null
afterEach(() => {
  tracker?.dispose()
  tracker = null
})

const key = (type: 'keydown' | 'keyup', ctrlKey: boolean) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: 'Control', ctrlKey, bubbles: true }))
const pointer = (type: 'pointermove' | 'pointerdown', ctrlKey: boolean) =>
  document.body.dispatchEvent(new PointerEvent(type, { ctrlKey, bubbles: true }))
const wheel = (ctrlKey: boolean, deltaY = -10, deltaMode = 0) =>
  new WheelEvent('wheel', { ctrlKey, deltaY, deltaMode })

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

describe('ctrlWheelAction', () => {
  it('zooms on touchpad pinch (ctrlKey set without Ctrl held)', () => {
    expect(ctrlWheelAction(wheel(true), false)).toBe('zoom')
    expect(ctrlWheelAction(wheel(true, -120), false)).toBe('zoom')
  })

  it('zooms on Ctrl + mouse wheel (notch-sized deltas)', () => {
    expect(ctrlWheelAction(wheel(true, -100), true)).toBe('zoom')
    expect(ctrlWheelAction(wheel(true, 120), true)).toBe('zoom')
    expect(ctrlWheelAction(wheel(true, 3, 1), true)).toBe('zoom') // line mode
  })

  it('scrolls on Ctrl + two-finger touchpad scroll or free-spin wheel (fine deltas)', () => {
    expect(ctrlWheelAction(wheel(true, -10), true)).toBe('scroll')
    expect(ctrlWheelAction(wheel(true, 4.5), true)).toBe('scroll')
  })

  it('leaves plain wheel scrolling to the browser', () => {
    expect(ctrlWheelAction(wheel(false), false)).toBe(null)
    expect(ctrlWheelAction(wheel(false, -100), true)).toBe(null)
  })
})
