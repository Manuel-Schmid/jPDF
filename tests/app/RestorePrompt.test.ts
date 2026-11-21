import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it } from 'vitest'
import RestorePrompt, { askToRestore } from '../../src/app/RestorePrompt.svelte'

describe('RestorePrompt', () => {
  it('offers the named file back and resolves with the clicked choice', async () => {
    render(RestorePrompt)
    for (const [label, choice] of [['Restore', 'restore'], ['Discard', 'discard'], ['Later', 'later']]) {
      const answer = askToRestore('lecture.pdf', false)
      await tick()
      expect(screen.getByText('JuliePDF closed unexpectedly. Restore unsaved changes to lecture.pdf?')).toBeTruthy()
      expect(screen.queryByText(/has changed since/)).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: label }))
      expect(await answer).toBe(choice)
      await tick()
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('warns when the file changed since and offers Restore anyway', async () => {
    render(RestorePrompt)
    const answer = askToRestore('a.pdf', true)
    await tick()
    expect(screen.getByText(/a\.pdf has changed since/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Restore anyway' }))
    expect(await answer).toBe('restore')
  })

  it('Escape answers Later (asked again next start)', async () => {
    render(RestorePrompt)
    const answer = askToRestore('a.pdf', false)
    await tick()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(await answer).toBe('later')
  })
})
