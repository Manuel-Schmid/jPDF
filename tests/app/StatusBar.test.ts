import { fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StatusBar from '../../src/app/StatusBar.svelte'
import { commands } from '../../src/core/registry/commands'
import type { DocumentSession } from '../../src/core/session/session.svelte'

function fakeSession(over: Partial<DocumentSession> = {}) {
  return {
    currentPage: 2,
    scale: 1.5,
    pageSizes: Array.from({ length: 10 }, () => ({ width: 600, height: 800 })),
    history: { canUndo: false, canRedo: false },
    goToPage: vi.fn(),
    zoomTo: vi.fn(),
    ...over,
  } as unknown as DocumentSession
}

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((d) => d()))

describe('StatusBar', () => {
  it('undo/redo buttons follow history and run the edit commands', async () => {
    const run = vi.fn()
    disposers.push(commands.register({ id: 'edit.undo', title: 'Undo', run }))
    const s = fakeSession({ history: { canUndo: true, canRedo: false } as never })
    const { getByRole } = render(StatusBar, { props: { session: s } })
    expect((getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('the settings button sits left of undo and runs app.settings', async () => {
    const run = vi.fn()
    disposers.push(commands.register({ id: 'app.settings', title: 'Settings', run }))
    const { getByRole, getAllByRole } = render(StatusBar, { props: { session: null } })
    const gear = getByRole('button', { name: 'Settings' })
    expect(gear.getAttribute('title')).toBe('Settings')
    expect(getAllByRole('button')[0]).toBe(gear)
    expect((gear as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(gear)
    expect(run).toHaveBeenCalledOnce()
  })

  it('the fullscreen button runs view.fullscreen', async () => {
    const run = vi.fn()
    disposers.push(commands.register({ id: 'view.fullscreen', title: 'Fullscreen', run }))
    const { getByRole } = render(StatusBar, { props: { session: fakeSession() } })
    await fireEvent.click(getByRole('button', { name: 'Fullscreen' }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('disables navigation and zoom without a document', () => {
    const { getByRole } = render(StatusBar, { props: { session: null } })
    expect(getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true)
    expect(getByRole('button', { name: 'Zoom in' })).toHaveProperty('disabled', true)
  })

  it('shows the current page and page count', () => {
    const { getByRole, getByText } = render(StatusBar, { props: { session: fakeSession() } })
    expect(getByRole('textbox', { name: 'Page number' })).toHaveProperty('value', '2')
    expect(getByText('/ 10')).toBeTruthy()
  })

  it('prev/next go to the neighbouring pages', async () => {
    const s = fakeSession()
    const { getByRole } = render(StatusBar, { props: { session: s } })
    await fireEvent.click(getByRole('button', { name: 'Next page' }))
    expect(s.goToPage).toHaveBeenLastCalledWith(3)
    await fireEvent.click(getByRole('button', { name: 'Previous page' }))
    expect(s.goToPage).toHaveBeenLastCalledWith(1)
  })

  it('page input jumps on Enter', async () => {
    const s = fakeSession()
    const { getByRole } = render(StatusBar, { props: { session: s } })
    const input = getByRole('textbox', { name: 'Page number' }) as HTMLInputElement
    await fireEvent.focus(input)
    await fireEvent.input(input, { target: { value: '7' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.goToPage).toHaveBeenCalledWith(7)
  })

  it('invalid page input reverts', async () => {
    const s = fakeSession()
    const { getByRole } = render(StatusBar, { props: { session: s } })
    const input = getByRole('textbox', { name: 'Page number' }) as HTMLInputElement
    await fireEvent.focus(input)
    await fireEvent.input(input, { target: { value: '99' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.goToPage).not.toHaveBeenCalled()
    expect(input.value).toBe('2')
  })

  it('zoom buttons run the zoom commands', async () => {
    const zoomIn = vi.fn(), zoomOut = vi.fn()
    disposers.push(
      commands.register({ id: 'view.zoomIn', title: 'Zoom in', run: zoomIn }),
      commands.register({ id: 'view.zoomOut', title: 'Zoom out', run: zoomOut }),
    )
    const { getByRole } = render(StatusBar, { props: { session: fakeSession() } })
    await fireEvent.click(getByRole('button', { name: 'Zoom in' }))
    await fireEvent.click(getByRole('button', { name: 'Zoom out' }))
    expect(zoomIn).toHaveBeenCalledOnce()
    expect(zoomOut).toHaveBeenCalledOnce()
  })

  it('zoom percentage becomes an input on click; Enter applies', async () => {
    const s = fakeSession()
    const { getByRole, queryByRole } = render(StatusBar, { props: { session: s } })
    await fireEvent.click(getByRole('button', { name: 'Zoom level 150%' }))
    const input = getByRole('textbox', { name: 'Zoom percentage' }) as HTMLInputElement
    expect(input.value).toBe('150')
    await fireEvent.input(input, { target: { value: '200' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.zoomTo).toHaveBeenCalledWith(2)
    expect(queryByRole('textbox', { name: 'Zoom percentage' })).toBeNull()
  })

  it('invalid zoom input is ignored', async () => {
    const s = fakeSession()
    const { getByRole } = render(StatusBar, { props: { session: s } })
    await fireEvent.click(getByRole('button', { name: 'Zoom level 150%' }))
    const input = getByRole('textbox', { name: 'Zoom percentage' })
    await fireEvent.input(input, { target: { value: 'abc' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.zoomTo).not.toHaveBeenCalled()
    expect(getByRole('button', { name: 'Zoom level 150%' })).toBeTruthy()
  })
})
