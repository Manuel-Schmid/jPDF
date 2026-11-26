import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../src/core/registry/tools'
import { SettingsStore } from '../../src/core/settings/settings.svelte'
import UpdatePrompt, { askToUpdate } from '../../src/app/UpdatePrompt.svelte'
import Modal from '../../src/ui/Modal.svelte'
import SettingsDialog from '../../src/ui/SettingsDialog.svelte'

const body = (text: string) => createRawSnippet(() => ({ render: () => `<button type="button">${text}</button>` }))

function open(label: string) {
  const onclose = vi.fn()
  const r = render(Modal, { props: { label, onclose, children: body(label) } })
  return { onclose, ...r }
}

const dialogs = () => screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))

afterEach(() => document.body.replaceChildren())

describe('Modal stacking', () => {
  it('the modal opened last is in front (last in the body)', () => {
    open('First')
    open('Second')
    expect(dialogs()).toEqual(['First', 'Second'])
    // Both backdrops sit directly in <body>, so with the same z-index the later one paints on top.
    for (const d of screen.getAllByRole('dialog')) expect(d.parentElement?.parentElement).toBe(document.body)
  })

  it('a pointer-down inside the top modal closes neither', async () => {
    const first = open('First')
    const second = open('Second')
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Second' }))
    expect(first.onclose).not.toHaveBeenCalled()
    expect(second.onclose).not.toHaveBeenCalled()
  })

  it('a pointer-down outside or Escape closes only the top modal', async () => {
    const first = open('First')
    const second = open('Second')
    await fireEvent.pointerDown(document.body)
    expect(second.onclose).toHaveBeenCalledOnce()
    expect(first.onclose).not.toHaveBeenCalled()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(second.onclose).toHaveBeenCalledTimes(2)
    expect(first.onclose).not.toHaveBeenCalled()
  })

  it('once the top modal is gone, the one below reacts again', async () => {
    const first = open('First')
    const second = open('Second')
    second.unmount()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(first.onclose).toHaveBeenCalledOnce()
  })

  it('Check now from Settings: the update prompt is in front and works; Settings stays open', async () => {
    const store = new SettingsStore({ load: async () => null, save: async () => {} }, createToolRegistry())
    const onclose = vi.fn()
    render(UpdatePrompt)
    render(SettingsDialog, { props: { store, onclose, category: 'updates' } })
    const choice = askToUpdate('9.9.9', 'Notes')
    await vi.waitFor(() => expect(dialogs()).toEqual(['Settings', 'Update available']))
    const update = screen.getByRole('button', { name: 'Update now' })
    await fireEvent.pointerDown(update)
    await fireEvent.click(update)
    await expect(choice).resolves.toBe('update')
    expect(onclose).not.toHaveBeenCalled()
  })
})

describe('Modal width', () => {
  const cardMax = () => screen.getByRole('dialog').style.getPropertyValue('--card-max-width')

  it('caps the card at 640px by default', () => {
    open('Confirm')
    expect(cardMax()).toBe('640px')
  })

  it('maxWidth widens only that card', () => {
    render(Modal, { props: { label: 'Wide', onclose: vi.fn(), children: body('Wide'), maxWidth: 720 } })
    expect(cardMax()).toBe('720px')
  })
})
