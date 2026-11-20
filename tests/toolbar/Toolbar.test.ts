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

/** Each button's reorder offset (px) along the axis. */
const shifts = (buttons: HTMLElement[]) =>
  buttons.map((b) => Math.round(Number(/\((-?[\d.e+-]+)px\)/.exec(b.style.transform)?.[1] ?? 0) * 10) / 10)

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

  it('"+" opens picker listing the tools that can be added, with description', async () => {
    const r = mount(fakeSetup([{ instanceId: 'p1', type: 'pen', settings: { width: 2 } }]))
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    const picker = r.getByRole('dialog', { name: 'Add tool' })
    expect(within(picker).getByText('Pen')).toBeTruthy()
    expect(within(picker).getByText('pen description')).toBeTruthy()
    expect(within(picker).getByText('hand description')).toBeTruthy()
  })

  it('the picker leaves out single-instance tools already in the toolbar and offers them again once removed', async () => {
    const r = mount() // pen (multi-instance) and hand (single-instance) are in the toolbar
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    let picker = r.getByRole('dialog', { name: 'Add tool' })
    expect(within(picker).getByText('Pen')).toBeTruthy()
    expect(within(picker).queryByText('Hand')).toBeNull()
    await fireEvent.keyDown(document.body, { key: 'Escape' })

    r.store.remove('h1')
    await tick()
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    picker = r.getByRole('dialog', { name: 'Add tool' })
    await fireEvent.click(within(picker).getByRole('button', { name: /Hand/ }))
    expect(r.store.data.toolbar.map((i) => i.type)).toEqual(['pen', 'hand'])
  })

  it('the picker says so when every tool is already in the toolbar', async () => {
    const setup = fakeSetup()
    setup.registry.get('pen').allowMultipleInstances = false
    const r = mount(setup)
    await fireEvent.click(r.getByRole('button', { name: 'Add tool' }))
    const picker = r.getByRole('dialog', { name: 'Add tool' })
    expect(within(picker).queryAllByRole('button')).toHaveLength(0)
    expect(within(picker).getByText('All tools are already in the toolbar.')).toBeTruthy()
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

  it('the Select tool cannot be removed: its menu has no Remove', async () => {
    const setup = fakeSetup([
      { instanceId: 's1', type: 'select', settings: {} },
      { instanceId: 'p1', type: 'pen', settings: { width: 2 } },
    ])
    setup.registry.register(fakeTool('select', { allowMultipleInstances: false, Options: null }))
    const r = mount(setup)
    await fireEvent.contextMenu(toolButtons(r)[0])
    expect(within(r.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Options'])
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
    // Follows the pointer, held at the last slot (96: it can't leave the strip); b and c moved up to make room.
    expect(shifts(buttons)).toEqual([96, -48, -48])
    expect(buttons[0].classList.contains('dragging')).toBe(true)
    await fireEvent.pointerUp(buttons[0], { clientX: 20, clientY: 130, pointerId: 1 })
    await fireEvent.click(buttons[0])
    await tick()
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['b', 'c', 'a'])
    expect(r.store.data.activeInstanceId).toBe('a')
    expect(r.queryByRole('dialog')).toBeNull()
    // The neighbours already sit in their new places: the offsets clear without a
    // transition (only the dropped button glides into its gap, via WAAPI).
    for (const b of buttons) {
      expect(b.style.transform).toBe('')
      expect(b.classList.contains('animated')).toBe(false)
      expect(b.classList.contains('dragging')).toBe(false)
    }
  })

  it('like the taskbar: the dragged button follows the pointer, neighbours snap aside once it covers half of them', async () => {
    const r = mount(fakeSetup([
      { instanceId: 'a', type: 'pen', settings: { width: 1 } },
      { instanceId: 'b', type: 'pen', settings: { width: 2 } },
      { instanceId: 'c', type: 'hand', settings: {} },
    ]))
    const buttons = toolButtons(r)
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    // Grabbed 5px below its centre: the button's centre stays 5px above the pointer.
    await fireEvent.pointerDown(buttons[0], { button: 0, clientX: 20, clientY: 25, pointerId: 1 })
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 35, pointerId: 1 })
    // Follows 1:1 (centre 30, 10px from its slot), no easing while it tracks the pointer.
    expect(shifts(buttons)).toEqual([10, 0, 0])
    expect(buttons[0].classList.contains('animated')).toBe(false)
    expect(buttons[1].classList.contains('animated')).toBe(true)
    // Further, but its centre (65) is short of b's (68): it keeps following, b stays.
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 70, pointerId: 1 })
    expect(shifts(buttons)).toEqual([45, 0, 0])
    // Its centre passes b's: b snaps up into the vacated slot; a just keeps following.
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 75, pointerId: 1 })
    expect(shifts(buttons)).toEqual([50, -48, 0])
    expect(buttons[0].classList.contains('animated')).toBe(false)
    expect(buttons[1].classList.contains('animated')).toBe(true)
    // Back above b's centre: b returns.
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 45, pointerId: 1 })
    expect(shifts(buttons)).toEqual([20, 0, 0])
    await fireEvent.pointerUp(buttons[0], { clientX: 20, clientY: 45, pointerId: 1 })
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['a', 'b', 'c'])
  })

  it('a cancelled drag slides back and does not reorder', async () => {
    const r = mount()
    const buttons = toolButtons(r)
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    await fireEvent.pointerDown(buttons[0], { button: 0, clientX: 20, clientY: 20, pointerId: 1 })
    await fireEvent.pointerMove(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    expect(shifts(buttons)).toEqual([48, -48])
    await fireEvent.pointerCancel(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    // Offsets reset, still animated so the buttons slide back.
    expect(buttons.map((b) => b.style.transform)).toEqual(['', ''])
    expect(buttons[0].classList.contains('animated')).toBe(true)
    await fireEvent.pointerUp(buttons[0], { clientX: 20, clientY: 90, pointerId: 1 })
    vi.runAllTimers()
    await tick()
    expect(buttons[0].classList.contains('animated')).toBe(false)
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['p1', 'h1'])
    expect(r.ipc.save).not.toHaveBeenCalled()
  })

  it('Escape cancels a drag: no reorder, no click, and the tool stays active', async () => {
    const r = mount()
    const buttons = toolButtons(r)
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    const reachedApp = vi.fn()
    window.addEventListener('keydown', reachedApp)
    try {
      await fireEvent.pointerDown(buttons[1], { button: 0, clientX: 20, clientY: 68, pointerId: 1 })
      await fireEvent.pointerMove(buttons[1], { clientX: 20, clientY: 10, pointerId: 1 })
      expect(shifts(buttons)).toEqual([48, -48])
      await fireEvent.keyDown(document.body, { key: 'Escape' })
      // Consumed, so the app's Escape does not also switch to Select.
      expect(reachedApp).not.toHaveBeenCalled()
      expect(buttons.map((b) => b.style.transform)).toEqual(['', ''])
      await fireEvent.pointerUp(buttons[1], { clientX: 20, clientY: 10, pointerId: 1 })
      await fireEvent.click(buttons[1])
      vi.runAllTimers()
      expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['p1', 'h1'])
      expect(r.store.data.activeInstanceId).toBe('p1')
      expect(r.ipc.save).not.toHaveBeenCalled()
      // With no drag, Escape passes through again.
      await fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(reachedApp).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('keydown', reachedApp)
    }
  })

  it('hidden instances of unregistered tools keep their place', async () => {
    const r = mount(fakeSetup([
      { instanceId: 'a', type: 'pen', settings: { width: 1 } },
      { instanceId: 'x', type: 'gone', settings: {} },
      { instanceId: 'b', type: 'hand', settings: {} },
    ]))
    const buttons = toolButtons(r)
    expect(buttons).toHaveLength(2)
    buttons.forEach((b, i) => {
      b.getBoundingClientRect = () =>
        ({ top: i * 48, bottom: i * 48 + 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: i * 48 }) as DOMRect
    })
    await fireEvent.pointerDown(buttons[1], { button: 0, clientX: 20, clientY: 68, pointerId: 1 })
    await fireEvent.pointerMove(buttons[1], { clientX: 20, clientY: 5, pointerId: 1 })
    expect(shifts(buttons)).toEqual([48, -48])
    await fireEvent.pointerUp(buttons[1], { clientX: 20, clientY: 5, pointerId: 1 })
    expect(r.store.data.toolbar.map((i) => i.instanceId)).toEqual(['b', 'a', 'x'])
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
      // Far down but barely sideways: a drag, but only x picks the slot (still its own).
      await fireEvent.pointerMove(buttons[0], { clientX: 22, clientY: 130, pointerId: 1 })
      expect(buttons[0].classList.contains('dragging')).toBe(true)
      expect(buttons[0].style.transform).toBe('translateX(2px)')
      // Past b's centre (68): b snaps left into the vacated slot; a follows the pointer.
      await fireEvent.pointerMove(buttons[0], { clientX: 90, clientY: 20, pointerId: 1 })
      expect(shifts(buttons)).toEqual([70, -48, 0])
      expect(buttons[1].style.transform).toBe('translateX(-48px)')
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
