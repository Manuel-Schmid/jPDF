import { fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StatusBar from '../../src/app/StatusBar.svelte'
import { commands } from '../../src/core/registry/commands'
import { generationRuns } from '../../src/ai/runs.svelte'
import type { DocumentSession } from '../../src/core/session/session.svelte'
import { settings } from '../../src/core/settings/settings.svelte'

function fakeSession(over: Partial<DocumentSession> = {}) {
  return {
    currentPage: 2,
    scale: 1.5,
    pageSizes: Array.from({ length: 10 }, () => ({ width: 600, height: 800 })),
    history: { canUndo: false, canRedo: false },
    goToPage: vi.fn(),
    zoomTo: vi.fn(),
    id: 'session-1',
    explanations: [],
    noTextPages: new Set(),
    explanationsHidden: false,
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

describe('StatusBar thumbnails button', () => {
  it('runs view.thumbnails, looks pressed while open and is disabled without a document', async () => {
    const run = vi.fn()
    disposers.push(commands.register({ id: 'view.thumbnails', title: 'Page thumbnails', run }))
    const { getByRole, rerender } = render(StatusBar, { props: { session: fakeSession(), thumbnailsOpen: true } })
    const btn = getByRole('button', { name: 'Page thumbnails' }) as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.title).toContain('Ctrl+B')
    expect(btn.title).toContain('F4')
    await fireEvent.click(btn)
    expect(run).toHaveBeenCalledOnce()
    await rerender({ session: null, thumbnailsOpen: false })
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('StatusBar AI and explanations', () => {
  const ex = { text: 'x', model: 'm', createdAt: 't' }
  afterEach(() => {
    settings.data.preferences.aiEnabled = false
    settings.data.preferences.aiCli = 'claude'
    generationRuns.clear('session-1')
  })

  it('shows no AI controls while AI features are off (the default)', () => {
    const { queryByText } = render(StatusBar, { props: { session: fakeSession({ explanations: [ex] } as never) } })
    expect(settings.data.preferences.aiEnabled).toBe(false)
    expect(queryByText(/explanations$/)).toBeNull()
  })

  it('offers "Add explanations", then "Regenerate explanations" once a page has one', () => {
    settings.data.preferences.aiEnabled = true
    const a = render(StatusBar, { props: { session: fakeSession({ explanations: [null] } as never) } })
    expect(a.getByText('Add explanations')).toBeTruthy()
    a.unmount()
    const b = render(StatusBar, { props: { session: fakeSession({ explanations: [ex] } as never) } })
    expect(b.getByText('Regenerate explanations')).toBeTruthy()
  })

  it('hides the AI controls in the Document Builder', () => {
    settings.data.preferences.aiEnabled = true
    const { queryByText } = render(StatusBar, { props: { session: fakeSession(), builderOpen: true } })
    expect(queryByText('Add explanations')).toBeNull()
  })

  it('names the chosen CLI and model in the button tooltip', () => {
    settings.data.preferences.aiEnabled = true
    const a = render(StatusBar, { props: { session: fakeSession() } })
    expect(a.getByTitle(/Claude Code, opus \(AI, Beta\): the document's text is sent to the provider/)).toBeTruthy()
    a.unmount()
    settings.data.preferences.aiCli = 'codex'
    const b = render(StatusBar, { props: { session: fakeSession() } })
    expect(b.getByTitle(/Codex CLI, default model \(AI, Beta\)/)).toBeTruthy()
  })

  it('shows "Starting Claude…" before the first page', () => {
    settings.data.preferences.aiEnabled = true
    generationRuns.update('session-1', { status: 'running', done: 0, total: 5 })
    const { getByText } = render(StatusBar, { props: { session: fakeSession() } })
    expect(getByText(/Starting Claude…/)).toBeTruthy()
  })

  it('shows "Starting Codex…" for Codex', () => {
    settings.data.preferences.aiEnabled = true
    settings.data.preferences.aiCli = 'codex'
    generationRuns.update('session-1', { status: 'running', done: 0, total: 5 })
    const { getByText } = render(StatusBar, { props: { session: fakeSession() } })
    expect(getByText(/Starting Codex…/)).toBeTruthy()
  })

  it('"Starting Claude…" gives way to "Explaining 0/5" after 3 s, even while progress updates', async () => {
    vi.useFakeTimers()
    try {
      settings.data.preferences.aiEnabled = true
      generationRuns.update('session-1', { status: 'running', done: 0, total: 5 })
      const { getByText } = render(StatusBar, { props: { session: fakeSession() } })
      await vi.advanceTimersByTimeAsync(2000)
      // Another update of the same run does not restart the start-up time.
      generationRuns.update('session-1', { total: 6 })
      await vi.advanceTimersByTimeAsync(900)
      expect(getByText(/Starting Claude…/)).toBeTruthy()
      await vi.advanceTimersByTimeAsync(100)
      expect(getByText(/Explaining 0\/6/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a new run starts with "Starting Claude…" again', async () => {
    vi.useFakeTimers()
    try {
      settings.data.preferences.aiEnabled = true
      generationRuns.update('session-1', { status: 'running', done: 0, total: 5 })
      const { getByText } = render(StatusBar, { props: { session: fakeSession() } })
      await vi.advanceTimersByTimeAsync(3000)
      expect(getByText(/Explaining 0\/5/)).toBeTruthy()
      generationRuns.update('session-1', { status: 'preparing' })
      await vi.advanceTimersByTimeAsync(0)
      generationRuns.update('session-1', { status: 'running' })
      await vi.advanceTimersByTimeAsync(0)
      expect(getByText(/Starting Claude…/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows Preparing pages 3/10 with Cancel', async () => {
    settings.data.preferences.aiEnabled = true
    const controller = new AbortController()
    generationRuns.update('session-1', { status: 'preparing', done: 3, total: 10, controller })
    const { getByText, getByRole } = render(StatusBar, { props: { session: fakeSession() } })
    expect(getByText('Preparing pages 3/10')).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: 'Cancel explanations' }))
    expect(controller.signal.aborted).toBe(true)
  })

  it('shows "Explaining 2/5" with Cancel', async () => {
    settings.data.preferences.aiEnabled = true
    const controller = new AbortController()
    generationRuns.update('session-1', { status: 'running', done: 2, total: 5, controller })
    const { getByText, getByRole } = render(StatusBar, { props: { session: fakeSession() } })
    expect(getByText(/Explaining 2\/5/)).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: 'Cancel explanations' }))
    expect(controller.signal.aborted).toBe(true)
  })

  it('the show/hide toggle appears with explanations and hides them all', async () => {
    const s = fakeSession({ explanations: [ex] } as never)
    const { getByRole } = render(StatusBar, { props: { session: s } })
    await fireEvent.click(getByRole('button', { name: 'Hide explanations' }))
    expect(s.explanationsHidden).toBe(true)
  })

  it('has no show/hide toggle without explanations', () => {
    const { queryByRole } = render(StatusBar, { props: { session: fakeSession() } })
    expect(queryByRole('button', { name: /explanations/ })).toBeNull()
  })
})
