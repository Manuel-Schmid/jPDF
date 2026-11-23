import { afterEach, describe, expect, it } from 'vitest'
import { ctrlWheelZooms, trackCtrlKey } from '../../../src/core/viewer/ctrlKey'

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

describe('ctrlWheelZooms', () => {
  it('zooms on touchpad pinch (ctrlKey set without Ctrl held)', () => {
    expect(ctrlWheelZooms(wheel(true), false)).toBe(true)
    expect(ctrlWheelZooms(wheel(true, -120), false)).toBe(true)
  })

  it('zooms on Ctrl + mouse wheel (notch-sized deltas)', () => {
    expect(ctrlWheelZooms(wheel(true, -100), true)).toBe(true)
    expect(ctrlWheelZooms(wheel(true, 120), true)).toBe(true)
    expect(ctrlWheelZooms(wheel(true, 3, 1), true)).toBe(true) // line mode
  })

  it('does not zoom on Ctrl + two-finger touchpad scroll (fine deltas)', () => {
    expect(ctrlWheelZooms(wheel(true, -10), true)).toBe(false)
    expect(ctrlWheelZooms(wheel(true, 4.5), true)).toBe(false)
  })

  it('ignores plain wheel scrolling', () => {
    expect(ctrlWheelZooms(wheel(false), false)).toBe(false)
    expect(ctrlWheelZooms(wheel(false, -100), true)).toBe(false)
  })
})
