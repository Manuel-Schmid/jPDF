import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import UpdatePrompt, { askToUpdate, showUpdateProgress } from '../../src/app/UpdatePrompt.svelte'

afterEach(() => showUpdateProgress(undefined))

describe('UpdatePrompt', () => {
  it('offers the version with its notes and resolves with the clicked choice', async () => {
    render(UpdatePrompt)
    for (const [label, choice] of [['Update now', 'update'], ['Later', 'later']]) {
      const answer = askToUpdate('1.0.4', 'Faster saving')
      await tick()
      expect(screen.getByText('JuliePDF 1.0.4 is available. Update now?')).toBeTruthy()
      expect(screen.getByText('Faster saving')).toBeTruthy()
      await fireEvent.click(screen.getByRole('button', { name: label }))
      expect(await answer).toBe(choice)
      await tick()
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('Escape answers Later', async () => {
    render(UpdatePrompt)
    const answer = askToUpdate('1.0.4', undefined)
    await tick()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(await answer).toBe('later')
  })

  it('a newer prompt answers the open one with Later', async () => {
    render(UpdatePrompt)
    const first = askToUpdate('1.0.4', undefined)
    const second = askToUpdate('1.0.5', undefined)
    expect(await first).toBe('later')
    await tick()
    expect(screen.getByText('JuliePDF 1.0.5 is available. Update now?')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(await second).toBe('later')
  })

  it('shows the download progress until hidden; Escape does not close it', async () => {
    render(UpdatePrompt)
    showUpdateProgress(null)
    await tick()
    expect(screen.getByText('Downloading the update…')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
    showUpdateProgress(0.42)
    await tick()
    expect(screen.getByText('Downloading the update… 42 %')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('progressbar')).toBeTruthy()
    showUpdateProgress(undefined)
    await tick()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
