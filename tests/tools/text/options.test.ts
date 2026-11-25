import { fireEvent, render, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Options from '../../../src/tools/text/Options.svelte'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, type TextSettings } from '../../../src/tools/text/settings'

const settings: TextSettings = { textColor: [0, 0, 0], fontSize: 12, background: null }

describe('text tool options', () => {
  it('font sizes go down to 6 pt', () => {
    expect(FONT_SIZE_MIN).toBe(6)
    const r = render(Options, { props: { settings, update: vi.fn() } })
    const slider = r.getByRole('slider', { name: 'Font size' }) as HTMLInputElement
    expect(slider.min).toBe(String(FONT_SIZE_MIN))
    expect(slider.max).toBe(String(FONT_SIZE_MAX))
  })

  it('groups the background settings under a "Background" title', () => {
    const r = render(Options, { props: { settings: { ...settings, background: { color: [1, 1, 0], opacity: 1 } }, update: vi.fn() } })
    const section = r.getByRole('region', { name: 'Background' })
    expect(within(section).getByRole('radiogroup', { name: 'Background' })).toBeTruthy()
    expect(within(section).getByRole('slider', { name: 'Background opacity' })).toBeTruthy()
    // The font controls stay above it.
    expect(within(section).queryByRole('slider', { name: 'Font size' })).toBeNull()
  })

  it('the title stays while the background is transparent', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    expect(r.getByRole('heading', { name: 'Background' })).toBeTruthy()
  })
})

describe('text alignment option', () => {
  it('sits in its own "Alignment" section below the background', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    const headings = r.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Background', 'Alignment'])
    const section = r.getByRole('region', { name: 'Alignment' })
    const group = within(section).getByRole('radiogroup', { name: 'Alignment' })
    expect(within(group).getAllByRole('radio').map((b) => b.textContent?.trim())).toEqual(['Left', 'Centre', 'Right'])
  })

  it('is left for settings saved before alignment existed', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    expect(r.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true')
  })

  it('updates the tool settings', async () => {
    const update = vi.fn()
    const r = render(Options, { props: { settings, update } })
    await fireEvent.click(r.getByRole('radio', { name: 'Right' }))
    expect(update).toHaveBeenCalledWith({ align: 'right' })
  })
})

describe('text font style options', () => {
  it('are off for settings saved before they existed', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    const group = r.getByRole('group', { name: 'Font style' })
    expect(within(group).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(group).getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('toggle bold and italic in the tool settings', async () => {
    const update = vi.fn()
    const r = render(Options, { props: { settings: { ...settings, bold: true }, update } })
    expect(r.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(r.getByRole('button', { name: 'Bold' }))
    expect(update).toHaveBeenLastCalledWith({ bold: false })
    await fireEvent.click(r.getByRole('button', { name: 'Italic' }))
    expect(update).toHaveBeenLastCalledWith({ italic: true })
  })
})
