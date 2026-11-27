import { fireEvent, render, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import ExplanationField, { QUICK_INSTRUCTIONS, type FieldAi } from '../../../src/core/viewer/ExplanationField.svelte'
import type { Explanation } from '../../../src/core/session/model'
import type { DocumentSession } from '../../../src/core/session/session.svelte'

function fakeSession() {
  const s = {
    pendingEdit: null as (() => void) | null,
    commitPendingEdit: vi.fn(() => {
      const c = s.pendingEdit
      s.pendingEdit = null
      c?.()
    }),
    editExplanation: vi.fn(),
    toggleExplanation: vi.fn(),
    removeExplanation: vi.fn(),
  }
  return s as typeof s & DocumentSession
}

const ex: Explanation = { text: 'This slide shows mitosis.', model: 'gemini-x', createdAt: 't' }

function mount(mode: 'open' | 'collapsed' | 'note', session = fakeSession(), ai: FieldAi | null = null) {
  const r = render(ExplanationField, {
    props: { session, index: 2, mode, explanation: mode === 'note' ? null : ex, top: 100, left: 10, width: 400, ai },
  })
  return { ...r, session }
}

describe('ExplanationField', () => {
  it('shows the explanation, its model, and is placed where the layout reserved room', () => {
    const { getByRole, getByText, container } = mount('open')
    const area = getByRole('textbox') as HTMLTextAreaElement
    expect(area.value).toBe('This slide shows mitosis.')
    expect(getByText('gemini-x')).toBeTruthy()
    const field = container.querySelector('section') as HTMLElement
    expect(field.style.top).toBe('100px')
    expect(field.style.width).toBe('400px')
  })

  it('commits typed text as one edit when it loses focus, and is the pending edit meanwhile', async () => {
    const { getByRole, session } = mount('open')
    const area = getByRole('textbox')
    await fireEvent.focus(area)
    expect(session.pendingEdit).not.toBeNull()
    await fireEvent.input(area, { target: { value: 'Edited' } })
    expect(session.editExplanation).not.toHaveBeenCalled()
    await fireEvent.blur(area)
    expect(session.editExplanation).toHaveBeenCalledExactlyOnceWith(2, 'Edited')
    expect(session.pendingEdit).toBeNull()
  })

  it('a save commits the text being typed (pending edit)', async () => {
    const { getByRole, session } = mount('open')
    const area = getByRole('textbox')
    await fireEvent.focus(area)
    await fireEvent.input(area, { target: { value: 'Typed' } })
    session.commitPendingEdit()
    expect(session.editExplanation).toHaveBeenCalledWith(2, 'Typed')
  })

  it('keeps Ctrl+Z inside the field (the document undo does not run)', async () => {
    const { getByRole } = mount('open')
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    await fireEvent.keyDown(getByRole('textbox'), { key: 'z', ctrlKey: true })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
  })

  it('collapses, shows a one-line preview when collapsed, and removes', async () => {
    const { getByRole, getByLabelText, session } = mount('open')
    await fireEvent.click(getByRole('button', { name: 'Collapse explanation' }))
    expect(session.toggleExplanation).toHaveBeenCalledWith(2)
    await fireEvent.click(getByLabelText('Remove explanation'))
    expect(session.removeExplanation).toHaveBeenCalledWith(2)
    const collapsed = mount('collapsed')
    expect(collapsed.container.querySelectorAll('textarea')).toHaveLength(0)
    expect(collapsed.container.querySelector('.preview')?.textContent).toBe('This slide shows mitosis.')
  })

  it('shows the no-text note', async () => {
    const { getByText } = mount('note')
    await tick()
    expect(getByText(/No text on this page/)).toBeTruthy()
  })

  describe('regenerate', () => {
    const fakeAi = (running: FieldAi['running'] = null) => ({ running, regenerate: vi.fn(), cancel: vi.fn() })

    it('has no regenerate button while AI is off', () => {
      expect(mount('open').queryByRole('button', { name: 'Regenerate explanation' })).toBeNull()
    })

    it('sits right before Remove, and its menu regenerates plainly or with a quick instruction', async () => {
      const ai = fakeAi()
      const r = mount('open', fakeSession(), ai)
      const buttons = [...r.container.querySelectorAll('header button')].map((b) => b.getAttribute('aria-label'))
      expect(buttons.slice(-2)).toEqual(['Regenerate explanation', 'Remove explanation'])
      await fireEvent.click(r.getByRole('button', { name: 'Regenerate explanation' }))
      const items = within(r.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent?.trim())
      expect(items).toEqual(['Regenerate', ...QUICK_INSTRUCTIONS.map((q) => q.label), 'Custom…'])
      await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Regenerate' }))
      expect(ai.regenerate).toHaveBeenLastCalledWith(null)
      await fireEvent.click(r.getByRole('button', { name: 'Regenerate explanation' }))
      await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Simpler' }))
      expect(ai.regenerate).toHaveBeenLastCalledWith(QUICK_INSTRUCTIONS[0].instruction)
    })

    it('keeps what is being typed before regenerating', async () => {
      const ai = fakeAi()
      const r = mount('open', fakeSession(), ai)
      await fireEvent.input(r.getByRole('textbox'), { target: { value: 'My own words' } })
      await fireEvent.click(r.getByRole('button', { name: 'Regenerate explanation' }))
      await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Regenerate' }))
      expect(r.session.editExplanation).toHaveBeenCalledWith(2, 'My own words')
    })

    it('Custom… asks for an instruction: Enter regenerates with it, Escape cancels', async () => {
      const ai = fakeAi()
      const r = mount('open', fakeSession(), ai)
      const custom = async () => {
        await fireEvent.click(r.getByRole('button', { name: 'Regenerate explanation' }))
        await fireEvent.click(within(r.getByRole('menu')).getByRole('menuitem', { name: 'Custom…' }))
        await tick()
        return r.getByRole('textbox', { name: 'How should the explanation change?' }) as HTMLInputElement
      }
      let input = await custom()
      expect(document.activeElement).toBe(input)
      await fireEvent.input(input, { target: { value: 'in English' } })
      await fireEvent.keyDown(input, { key: 'Enter' })
      expect(ai.regenerate).toHaveBeenCalledWith('in English')
      expect(r.queryByRole('textbox', { name: 'How should the explanation change?' })).toBeNull()
      input = await custom()
      await fireEvent.input(input, { target: { value: 'nope' } })
      await fireEvent.keyDown(input, { key: 'Escape' })
      expect(ai.regenerate).toHaveBeenCalledOnce()
      expect(r.queryByRole('textbox', { name: 'How should the explanation change?' })).toBeNull()
    })

    it("while this page regenerates the button stops it; while another run goes it is disabled", async () => {
      const ai = fakeAi('this')
      const r = mount('open', fakeSession(), ai)
      await fireEvent.click(r.getByRole('button', { name: 'Stop regenerating' }))
      expect(ai.cancel).toHaveBeenCalledOnce()
      expect(r.queryByRole('menu')).toBeNull()
      const other = mount('open', fakeSession(), fakeAi('other'))
      expect((other.getByRole('button', { name: 'Regenerate explanation' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
