import { render, fireEvent } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import EmptyState from '../../src/app/EmptyState.svelte'

describe('EmptyState', () => {
  it('calls onOpen when Open PDF is clicked', async () => {
    const onOpen = vi.fn()
    const { getByRole } = render(EmptyState, { props: { onOpen } })
    await fireEvent.click(getByRole('button', { name: 'Open PDF' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows the full juliePDF logo', () => {
    const { getByText } = render(EmptyState, { props: { onOpen: vi.fn() } })
    expect(getByText('julie').className).toContain('logo-j')
  })

  it('offers Merge PDFs when onMerge is given', async () => {
    const onMerge = vi.fn()
    const { getByRole } = render(EmptyState, { props: { onOpen: vi.fn(), onMerge } })
    await fireEvent.click(getByRole('button', { name: 'Merge PDFs…' }))
    expect(onMerge).toHaveBeenCalledOnce()
  })

  it('has no merge link without onMerge', () => {
    const { queryByRole } = render(EmptyState, { props: { onOpen: vi.fn() } })
    expect(queryByRole('button', { name: 'Merge PDFs…' })).toBeNull()
  })
})

describe('EmptyState recent files', () => {
  const recent = [
    { path: 'C:\\Uni\\Lectures\\week2.pdf', openedAt: Date.now() },
    { path: 'C:\\Uni\\Lectures\\week1.pdf', openedAt: Date.now() - 86_400_000 * 30 },
  ]

  it('lists recent files with name, folder and date; a click opens one', async () => {
    const onOpenRecent = vi.fn()
    const { getByRole, getByTitle, getAllByText, getByText } = render(EmptyState, { props: { onOpen: vi.fn(), recent, onOpenRecent } })
    expect(getByRole('heading', { name: 'Recent files' })).toBeTruthy()
    expect(getAllByText('C:\\Uni\\Lectures')).toHaveLength(2)
    expect(getByText('Today')).toBeTruthy()
    await fireEvent.click(getByTitle('C:\\Uni\\Lectures\\week1.pdf'))
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\Uni\\Lectures\\week1.pdf')
  })

  it('shows no list when it is empty', () => {
    const { queryByRole } = render(EmptyState, { props: { onOpen: vi.fn(), recent: [], onOpenRecent: vi.fn() } })
    expect(queryByRole('heading', { name: 'Recent files' })).toBeNull()
  })

  it('right-click offers Remove from list; the remove button does the same', async () => {
    const onRemoveRecent = vi.fn()
    const { getByRole, getByTitle } = render(EmptyState, { props: { onOpen: vi.fn(), recent, onOpenRecent: vi.fn(), onRemoveRecent } })
    await fireEvent.contextMenu(getByTitle('C:\\Uni\\Lectures\\week2.pdf'))
    await fireEvent.click(getByRole('menuitem', { name: 'Remove from list' }))
    expect(onRemoveRecent).toHaveBeenCalledWith('C:\\Uni\\Lectures\\week2.pdf')
    await fireEvent.click(getByRole('button', { name: 'Remove week1.pdf from list' }))
    expect(onRemoveRecent).toHaveBeenLastCalledWith('C:\\Uni\\Lectures\\week1.pdf')
  })
})
