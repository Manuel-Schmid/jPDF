import { fireEvent, render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ContextMenu, { menuPosition, type MenuItem } from '../../src/ui/ContextMenu.svelte'

function mount(items: MenuItem[]) {
  const onclose = vi.fn()
  const r = render(ContextMenu, { props: { x: 10, y: 10, items, onclose } })
  const buttons = [...r.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  return { ...r, onclose, buttons, menu: r.container.querySelector<HTMLElement>('[role="menu"]')! }
}

describe('ContextMenu disabled items', () => {
  it('renders a disabled item that cannot be chosen', async () => {
    const run = vi.fn()
    const { buttons, onclose } = mount([{ label: 'A', run: vi.fn() }, { label: 'B', disabled: true, run }])
    expect(buttons[1].disabled).toBe(true)
    await fireEvent.click(buttons[1])
    expect(run).not.toHaveBeenCalled()
    expect(onclose).not.toHaveBeenCalled()
  })

  it('arrow keys skip disabled items', async () => {
    const { buttons, menu } = mount([
      { label: 'A', run: vi.fn() },
      { label: 'B', disabled: true, run: vi.fn() },
      { label: 'C', run: vi.fn() },
    ])
    buttons[0].focus()
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[2])
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[0])
    await fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[2])
  })

  it('focuses the first enabled item on open', () => {
    const { buttons } = mount([{ label: 'A', disabled: true, run: vi.fn() }, { label: 'B', run: vi.fn() }])
    expect(document.activeElement).toBe(buttons[1])
  })
})

describe('ContextMenu placement', () => {
  it('is placed at the pointer and only then marked shown (no flash at the top-left)', () => {
    const r = render(ContextMenu, { props: { x: 120, y: 80, items: [{ label: 'A', run: vi.fn() }], onclose: vi.fn() } })
    const menu = r.container.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('80px')
    expect(menu.hasAttribute('data-placed')).toBe(true)
  })

  it('menuPosition keeps the menu inside the window, opening leftwards / upwards at the right / bottom edge', () => {
    // Room on the right and below: at the pointer.
    expect(menuPosition(100, 100, 200, 150, 1000, 800)).toEqual({ left: 100, top: 100 })
    // Too close to the right edge: to the left of the pointer.
    expect(menuPosition(900, 100, 200, 150, 1000, 800)).toEqual({ left: 700, top: 100 })
    // Too close to the bottom (e.g. a toolbar at the bottom): above the pointer.
    expect(menuPosition(100, 750, 200, 150, 1000, 800)).toEqual({ left: 100, top: 600 })
    // Pointer inside the bottom margin: still fully inside the window.
    expect(menuPosition(100, 798, 200, 150, 1000, 800)).toEqual({ left: 100, top: 642 })
    // Never past the top-left margin.
    expect(menuPosition(2, 2, 200, 150, 150, 100)).toEqual({ left: 8, top: 8 })
  })
})
