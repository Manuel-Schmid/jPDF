import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { FindState } from '../../src/app/find.svelte'
import SearchBox from '../../src/app/SearchBox.svelte'
import type { SearchHit } from '../../src/core/viewer/search'

function hit(page: number): SearchHit {
  return { page, quads: [] }
}

describe('SearchBox', () => {
  it('shows a search button that opens and focuses the field', async () => {
    const find = new FindState(() => null)
    const { getByRole } = render(SearchBox, { props: { find } })
    await fireEvent.click(getByRole('button', { name: 'Find' }))
    const input = getByRole('textbox', { name: 'Find in document' })
    expect(document.activeElement).toBe(input)
  })

  it('typing sets the query; the count shows the current hit', async () => {
    const find = new FindState(() => null)
    find.show()
    const { getByRole, getByText } = render(SearchBox, { props: { find } })
    await fireEvent.input(getByRole('textbox'), { target: { value: 'foo' } })
    expect(find.query).toBe('foo')
    getByText('0 / 0')
    const hits = [hit(0), hit(1), hit(4)]
    find.hits = hits
    find.current = hits[1]
    await tick()
    getByText('2 / 3')
  })

  it('Enter / Shift+Enter and the arrow buttons step through the hits', async () => {
    const find = new FindState(() => null)
    find.show()
    const next = vi.spyOn(find, 'next')
    const previous = vi.spyOn(find, 'previous')
    const { getByRole } = render(SearchBox, { props: { find } })
    const input = getByRole('textbox')
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(next).toHaveBeenCalledOnce()
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(previous).toHaveBeenCalledOnce()
    expect(getByRole('button', { name: 'Next match' })).toHaveProperty('disabled', true)
    find.hits = [hit(0)]
    await tick()
    await fireEvent.click(getByRole('button', { name: 'Next match' }))
    await fireEvent.click(getByRole('button', { name: 'Previous match' }))
    expect(next).toHaveBeenCalledTimes(2)
    expect(previous).toHaveBeenCalledTimes(2)
  })

  it('Esc clears and closes the field without reaching the window', async () => {
    const find = new FindState(() => null)
    find.show()
    find.query = 'abc'
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    const { getByRole, queryByRole } = render(SearchBox, { props: { find } })
    await fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
    expect(find.open).toBe(false)
    expect(find.query).toBe('')
    expect(queryByRole('textbox')).toBeNull()
  })

  it('keeps text-editing shortcuts in the field', async () => {
    const find = new FindState(() => null)
    find.show()
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    const { getByRole } = render(SearchBox, { props: { find } })
    await fireEvent.keyDown(getByRole('textbox'), { key: 'z', ctrlKey: true })
    await fireEvent.keyDown(getByRole('textbox'), { key: 'f', ctrlKey: true })
    window.removeEventListener('keydown', onWindow)
    // Ctrl+Z stays in the field; Ctrl+F still reaches the keybindings.
    expect(onWindow).toHaveBeenCalledOnce()
  })
})
