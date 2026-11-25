import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Options from '../../../src/tools/marker/Options.svelte'
import type { MarkerSettings } from '../../../src/tools/marker/settings'

const settings: MarkerSettings = { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12, holdStraight: true }

describe('marker tool options', () => {
  it('text mode shows the freehand controls too (blank space draws freehand)', () => {
    const r = render(Options, { props: { settings, update: vi.fn() } })
    expect(r.getByRole('slider', { name: 'Thickness' })).toBeTruthy()
    expect(r.getByRole('radiogroup', { name: 'Hold to straighten' })).toBeTruthy()
  })
})
