import { fireEvent, render, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Options from '../../../src/tools/marker/Options.svelte'
import type { MarkerSettings } from '../../../src/tools/marker/settings'

const settings: MarkerSettings = { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12, holdStraight: true }

describe('marker tool options', () => {
  it('text mode offers SmartMark™, off by default, and no freehand controls while it is off', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    const smart = r.getByRole('radiogroup', { name: 'SmartMark™' })
    expect(within(smart).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true')
    expect(r.queryByRole('slider', { name: 'Thickness' })).toBeNull()
  })

  it('turning SmartMark™ on updates the settings', async () => {
    const update = vi.fn()
    const r = render(Options, { props: { settings, update } })
    await fireEvent.click(within(r.getByRole('radiogroup', { name: 'SmartMark™' })).getByRole('radio', { name: 'On' }))
    expect(update).toHaveBeenCalledWith({ smartMark: true })
  })

  it('with SmartMark™ on, text mode shows the freehand controls (blank space draws freehand)', () => {
    const r = render(Options, { props: { settings: { ...settings, smartMark: true }, update: vi.fn() } })
    expect(r.getByRole('slider', { name: 'Thickness' })).toBeTruthy()
    expect(r.getByRole('radiogroup', { name: 'Hold to straighten' })).toBeTruthy()
  })

  it('freehand mode has no SmartMark™ switch', () => {
    const r = render(Options, { props: { settings: { ...settings, mode: 'freehand' }, update: vi.fn() } })
    expect(r.queryByRole('radiogroup', { name: 'SmartMark™' })).toBeNull()
    expect(r.getByRole('slider', { name: 'Thickness' })).toBeTruthy()
  })
})
