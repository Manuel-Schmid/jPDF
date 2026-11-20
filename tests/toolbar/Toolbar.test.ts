import { fireEvent, render, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toolbar from '../../src/toolbar/Toolbar.svelte'
import { fakeSetup, fakeTool } from './fakeTools'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function mount(setup = fakeSetup()) {
  const r = render(Toolbar, { props: { registry: setup.registry, store: setup.store } })
  return { ...r, ...setup }
}

/** Tool instance buttons (the "+" button has no aria-pressed). */
const toolButtons = (r: ReturnType<typeof mount>) =>
  within(r.getByRole('toolbar')).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))

describe('Toolbar', () => {
  it('renders one button per instance', () => {
    const r = mount(fakeSetup([
      { instanceId: 'p1', type: 'pen', settings: { width: 2, color: [1, 0, 0] } },
      { instanceId: 'p2', type: 'pen', settings: { width: 2, color: [0, 0, 1] } },
      { instanceId: 'h1', type: 'hand', settings: {} },
    ]))
    const buttons = toolButtons(r)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Pen', 'Pen', 'Hand'])
    // Icons receive the instance's own settings (colour-aware).
    expect([...r.container.querySelectorAll('.fake-icon')].map((i) => i.getAttribute('data-color')))
      .toEqual(['1,0,0', '0,0,1', null])
  })

  it('hides instances of unregistered tool types', () => {
    const r = mount(fakeSetup([
      { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
      { instanceId: 'x1', type: 'future', settings: {} },
    ]))
    expect(toolButtons(r)).toHaveLength(1)
  })

  it('clicking inactive instance activates it', async () => {
    const r = mount()
    const [pen, hand] = toolButtons(r)
    expect(pen.getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(hand)
    expect(r.store.data.activeInstanceId).toBe('h1')
    expect(hand.getAttribute('aria-pressed')).toBe('true')
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('the options flyout toggles the tool lock, with a tooltip explaining it', async () => {
    const setup = fakeSetup()
    setup.registry.get('pen').defaultLocked = true
    const r = mount(setup)
    await fireEvent.click(toolButtons(r)[0])
    const flyout = r.getByRole('dialog', { name: 'Pen options' })
    const lock = within(flyout).getByRole('button', { name: 'Lock tool' })
    expect(lock.getAttribute('aria-pressed')).toBe('true')
    expect(lock.getAttribute('title')).toMatch(/stays active/)
    await fireEvent.click(lock)
    expect(r.store.data.toolbar[0].locked).toBe(false)
    expect(lock.getAttribute('aria-pressed')).toBe('false')
    expect(lock.getAttribute('title')).toMatch(/back to Select/)
  })

  it('tools without a lock show no lock button', async () => {
    const r = mount()
    await fireEvent.click(toolButtons(r)[0])
    expect(within(r.getByRole('dialog')).queryByRole('button', { name: 'Lock tool' })).toBeNull()
  })

  it('clicking active instance opens options flyout', async () => {
    const r = mount()
    await fireEvent.click(toolButtons(r)[0])
    const flyout = r.getByRole('dialog', { name: 'Pen options' })
    await fireEvent.click(within(flyout).getByRole('button', { name: 'Width 2' }))
    expect(r.store.data.toolbar[0].settings).toMatchObject({ width: 3 })
    // Clicking the active tool again toggles the flyout closed.
    await fireEvent.pointerDown(toolButtons(r)[0])
    await fireEvent.click(toolButtons(r)[0])
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('Escape closes flyout', async () => {
    const r = mount()
    await fireEvent.click(toolButtons(r)[0])
    expect(r.getByRole('dialog')).toBeTruthy()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    try {
      await fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(r.queryByRole('dialog')).toBeNull()
      // Consumed by the flyout, not passed on to the keybindings.
      expect(outer).not.toHaveBeenCalled()
      // With nothing open, Escape passes through.
      await fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(outer).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('keydown', outer)
    }
  })

  it('outside click closes flyout', async () => {
    const r = mount()
    await fireEvent.click(toolButtons(r)[0])
    await fireEvent.pointerDown(document.body)
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('a tool without options says so in its flyout', async () => {
    const r = mount()
    await fireEvent.click(toolButtons(r)[1])
    await fireEvent.click(toolButtons(r)[1])
    expect(within(r.getByRole('dialog', { name: 'Hand options' })).getByText('No options')).toBeTruthy()
  })

  it('"+" opens picker listing registered tools with description', async () => {
    const r = mount()
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    const picker = r.getByRole('dialog', { name: 'Add tool' })
    expect(within(picker).getByText('Pen')).toBeTruthy()
    expect(within(picker).getByText('pen description')).toBeTruthy()
    expect(within(picker).getByText('hand description')).toBeTruthy()
  })

  it('choosing a tool in picker appends instance and closes picker', async () => {
    const r = mount()
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    await fireEvent.click(within(r.getByRole('dialog', { name: 'Add tool' })).getByRole('button', { name: /Pen/ }))
    expect(r.store.data.toolbar.map((i) => i.type)).toEqual(['pen', 'hand', 'pen'])
    expect(r.store.data.activeInstanceId).toBe(r.store.data.toolbar[2].instanceId)
    expect(r.queryByRole('dialog')).toBeNull()
    expect(toolButtons(r)).toHaveLength(3)
  })

  it('Escape and backdrop click close the picker', async () => {
    const r = mount()
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    await fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(r.queryByRole('dialog')).toBeNull()
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    await fireEvent.pointerDown(r.container.ownerDocument.querySelector('.backdrop')!)
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('right-click menu: Duplicate and Remove; Duplicate hidden for single-instance tools', async () => {
    const r = mount()
    await fireEvent.contextMenu(toolButtons(r)[1])
    let menu = r.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Options', 'Remove'])
    await fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(r.queryByRole('menu')).toBeNull()

    await fireEvent.contextMenu(toolButtons(r)[0])
    menu = r.getByRole('menu')
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
    expect(r.store.data.toolbar.map((i) => i.type)).toEqual(['pen', 'pen', 'hand'])
    expect(r.queryByRole('menu')).toBeNull()

    await fireEvent.contextMenu(toolButtons(r)[2])
    await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Remove' }))
    expect(r.store.data.toolbar.map((i) => i.type)).toEqual(['pen', 'pen'])
  })

  it('right-click Options opens the flyout for that instance', async () => {
    const r = mount()
    await fireEvent.contextMenu(toolButtons(r)[1])
    await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Options' }))
    expect(r.getByRole('dialog', { name: 'Hand options' })).toBeTruthy()
  })

  it('drag past the threshold reorders and does not count as a click', async () => {
    const r = mount(fakeSetup([
      { instanceId: 'a', type: 'pen', settings: { width: 1 } },
      { instanceId: 'b', type: 'pen', settings: { width: 2 } },
      { instanceId: 'c', type: 'hand', settings: {} },
    ]))
    const buttons = toolButtons(r)
    // jsdom has no layout: stack the buttons 48px apart.
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    await fireEvent.pointerDown(buttons[0], { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 22, pointerId: 1 })
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 130, pointerId: 1 })
    await fireEvent.pointerUp(buttons[0], { clientX: 20, clientY: 130, pointerId: 1 })
    await fireEvent.click(buttons[0])
    await tick()
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['b', 'c', 'a'])
    expect(r.store.data.activeInstanceId).toBe('a')
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('a cancelled drag does not reorder', async () => {
    const r = mount()
    const buttons = toolButtons(r)
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    await fireEvent.pointerDown(buttons[0], { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    expect(r.container.querySelector('.drop-indicator')).not.toBeNull()
    await fireEvent.pointerCancel(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    await fireEvent.pointerUp(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    vi.runAllTimers()
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['p1', 'h1'])
    expect(r.container.querySelector('.drop-indicator')).toBeNull()
    expect(r.ipc.save).not.toHaveBeenCalled()
  })

  it('a small wobble below the threshold is still a click', async () => {
    const r = mount()
    const [, hand] = toolButtons(r)
    await fireEvent.pointerDown(hand, { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
    await fireEvent.pointerMove(hand, { clientX: 22, clientY: 23, pointerId: 1 })
    await fireEvent.pointerUp(hand, { clientX: 22, clientY: 23, pointerId: 1 })
    await fireEvent.click(hand)
    expect(r.store.data.activeInstanceId).toBe('h1')
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['p1', 'h1'])
  })

  it('is vertical at the right (default) and left edge, horizontal at the top and bottom', () => {
    const cases = [['right', 'vertical'], ['left', 'vertical'], ['top', 'horizontal'], ['bottom', 'horizontal']] as const
    for (const [position, orientation] of cases) {
      const r = mount(fakeSetup(undefined, position))
      const bar = r.getByRole('toolbar')
      expect(bar.getAttribute('aria-orientation')).toBe(orientation)
      expect(bar.classList.contains('horizontal')).toBe(orientation === 'horizontal')
      r.unmount()
    }
  })

  it('opens the options flyout toward the page area and follows a position change', async () => {
    const r = mount(fakeSetup(undefined, 'top'))
    await fireEvent.click(toolButtons(r)[0])
    expect(r.getByRole('dialog', { name: 'Pen options' }).dataset.side).toBe('bottom')
    // The active marker sits on the strip edge facing the page.
    expect(toolButtons(r)[0].dataset.side).toBe('bottom')
    r.store.setPreference('toolbarPosition', 'left')
    await tick()
    expect(r.getByRole('dialog', { name: 'Pen options' }).dataset.side).toBe('right')
    expect(r.getByRole('toolbar').getAttribute('aria-orientation')).toBe('vertical')
  })

  it('at the top or bottom, drag reorders along x', async () => {
    for (const position of ['top', 'bottom'] as const) {
      const r = mount(fakeSetup([
        { instanceId: 'a', type: 'pen', settings: { width: 1 } },
        { instanceId: 'b', type: 'pen', settings: { width: 2 } },
        { instanceId: 'c', type: 'hand', settings: {} },
      ], position))
      const buttons = toolButtons(r)
      // Side by side, 48px apart.
      buttons.forEach((b, i) => {
        b.getBoundingClientRect = () =>
          ({ left: i * 48, right: i * 48 + 40, top: 0, bottom: 40, width: 40, height: 40, x: i * 48, y: 0 }) as DOMRect
      })
      await fireEvent.pointerDown(buttons[0], { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
      // Far down but barely sideways: a drag, but the button only follows along x.
      await fireEvent.pointerMove(buttons[0], { clientX: 22, clientY: 130, pointerId: 1 })
      expect(buttons[0].style.transform).toBe('translateX(2px)')
      await fireEvent.pointerMove(buttons[0], { clientX: 90, clientY: 20, pointerId: 1 })
      expect(buttons[0].style.transform).toBe('translateX(70px)')
      const indicator = r.container.querySelector<HTMLElement>('.drop-indicator')!
      expect(indicator.style.left).not.toBe('')
      expect(indicator.style.top).toBe('')
      await fireEvent.pointerUp(buttons[0], { clientX: 90, clientY: 20, pointerId: 1 })
      await tick()
      expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['b', 'a', 'c'])
      r.unmount()
    }
  })

  it('a horizontal strip scrolls sideways with the mouse wheel', () => {
    const r = mount(fakeSetup(undefined, 'bottom'))
    const list = r.container.querySelector<HTMLElement>('.list')!
    const e = new WheelEvent('wheel', { deltaY: 60, cancelable: true })
    list.dispatchEvent(e)
    expect(list.scrollLeft).toBe(60)
    expect(e.defaultPrevented).toBe(true)
  })

  it('a vertical strip leaves the wheel alone', () => {
    const r = mount()
    const list = r.container.querySelector<HTMLElement>('.list')!
    const e = new WheelEvent('wheel', { deltaY: 60, cancelable: true })
    list.dispatchEvent(e)
    expect(list.scrollLeft).toBe(0)
    expect(e.defaultPrevented).toBe(false)
  })
})
