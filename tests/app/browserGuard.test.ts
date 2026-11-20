import { afterEach, describe, expect, it } from 'vitest'
import { guardBrowserBehavior } from '../../src/app/browserGuard'

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

function fire(target: EventTarget, type: 'contextmenu' | 'dragstart'): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

function add<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.body.appendChild(document.createElement(tag))
}

let dispose: (() => void) | null = null
afterEach(() => {
  dispose?.()
  dispose = null
  document.body.innerHTML = ''
})

describe('guardBrowserBehavior', () => {
  it('suppresses the WebView context menu everywhere, including text fields', () => {
    dispose = guardBrowserBehavior(window)
    expect(fire(add('div'), 'contextmenu').defaultPrevented).toBe(true)
    expect(fire(add('input'), 'contextmenu').defaultPrevented).toBe(true)
  })

  it('still lets the app open its own context menu', () => {
    dispose = guardBrowserBehavior(window)
    const button = add('button')
    let opened = false
    button.addEventListener('contextmenu', () => (opened = true))
    fire(button, 'contextmenu')
    expect(opened).toBe(true)
  })

  it.each([
    { key: 'F5' },
    { key: 'r', ctrlKey: true },
    { key: 'R', ctrlKey: true, shiftKey: true },
    { key: 'p', ctrlKey: true },
    { key: 'f', ctrlKey: true },
    { key: 'F3' },
    { key: 'g', ctrlKey: true },
    { key: 'F7' },
    { key: 'u', ctrlKey: true },
    { key: 'ArrowLeft', altKey: true },
    { key: 'BrowserBack' },
  ])('cancels the browser shortcut %o', (init) => {
    dispose = guardBrowserBehavior(window)
    expect(key(add('div'), init).defaultPrevented).toBe(true)
  })

  it('leaves app and editing shortcuts alone', () => {
    dispose = guardBrowserBehavior(window)
    const el = add('div')
    for (const init of [
      { key: 'o', ctrlKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'c', ctrlKey: true },
      { key: 'f' },
      { key: 'ArrowLeft' },
      { key: 'F12' },
    ]) {
      expect(key(el, init).defaultPrevented).toBe(false)
    }
  })

  it('does not stop a cancelled shortcut from reaching app keybindings', () => {
    dispose = guardBrowserBehavior(window)
    let seen = false
    const onKey = () => (seen = true)
    window.addEventListener('keydown', onKey)
    key(add('div'), { key: 'f', ctrlKey: true })
    window.removeEventListener('keydown', onKey)
    expect(seen).toBe(true)
  })

  it('blocks dragging UI chrome but not text in fields or deliberately draggable elements', () => {
    dispose = guardBrowserBehavior(window)
    expect(fire(add('img'), 'dragstart').defaultPrevented).toBe(true)
    expect(fire(add('a'), 'dragstart').defaultPrevented).toBe(true)
    expect(fire(add('textarea'), 'dragstart').defaultPrevented).toBe(false)
    const row = add('div')
    row.draggable = true
    expect(fire(row, 'dragstart').defaultPrevented).toBe(false)
  })

  it('stops guarding once disposed', () => {
    guardBrowserBehavior(window)()
    expect(fire(add('div'), 'contextmenu').defaultPrevented).toBe(false)
    expect(key(add('div'), { key: 'F5' }).defaultPrevented).toBe(false)
  })
})
