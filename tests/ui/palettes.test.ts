import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '../../src/core/registry/tools'
import type { RGB } from '../../src/core/session/model'
import { PALETTE_SIZE, PREFERENCES, readPreferences } from '../../src/core/settings/preferences'
import { SettingsStore, settings } from '../../src/core/settings/settings.svelte'
import { MARKER_PRESETS } from '../../src/tools/marker/settings'
import MarkerControls from '../../src/tools/marker/MarkerControls.svelte'
import { PEN_PRESETS } from '../../src/tools/pen/settings'
import PenControls from '../../src/tools/pen/PenControls.svelte'
import StyleControls from '../../src/tools/shape/StyleControls.svelte'
import TextControls from '../../src/tools/text/TextControls.svelte'
import TextLineControls from '../../src/tools/textline/TextLineControls.svelte'
import ColorPicker from '../../src/ui/ColorPicker.svelte'
import SettingsDialog from '../../src/ui/SettingsDialog.svelte'
import { toasts } from '../../src/ui/toasts.svelte'

const RED: RGB = [1, 0, 0]
const six = (c: RGB): RGB[] => Array.from({ length: PALETTE_SIZE }, () => [...c] as RGB)

function store() {
  return new SettingsStore({ load: async () => null, save: vi.fn(async () => {}) }, createToolRegistry())
}

describe('palette preferences', () => {
  it('default to the built-in pen and marker colours', () => {
    const p = readPreferences(undefined)
    expect(p.penPalette).toEqual(PEN_PRESETS)
    expect(p.markerPalette).toEqual(MARKER_PRESETS)
    expect(PEN_PRESETS).toHaveLength(PALETTE_SIZE)
    expect(MARKER_PRESETS).toHaveLength(PALETTE_SIZE)
  })

  it('keep exactly six valid colours; anything else falls back to the defaults', () => {
    expect(readPreferences({ penPalette: six(RED) }).penPalette).toEqual(six(RED))
    const bad = [six(RED).slice(1), [...six(RED), RED], [[2, 0, 0], ...six(RED).slice(1)], [[1, 0], ...six(RED).slice(1)], '#ff0000', null]
    for (const penPalette of bad) expect(readPreferences({ penPalette }).penPalette).toEqual(PEN_PRESETS)
  })

  it('a default palette is a copy: changing one never changes another or the built-in colours', () => {
    const a = readPreferences(undefined)
    a.penPalette[0][0] = 0.5
    expect(readPreferences(undefined).penPalette[0]).toEqual(PEN_PRESETS[0])
    expect(PREFERENCES.penPalette.default[0]).toEqual(PEN_PRESETS[0])
  })
})

describe('SettingsStore palettes', () => {
  it('setPaletteColor replaces one colour; resetPalette brings the built-in ones back', () => {
    const s = store()
    s.setPaletteColor('markerPalette', 2, RED)
    expect(s.data.preferences.markerPalette[2]).toEqual(RED)
    expect(s.data.preferences.markerPalette.filter((_, i) => i !== 2)).toEqual(MARKER_PRESETS.filter((_, i) => i !== 2))
    s.resetPalette('markerPalette')
    expect(s.data.preferences.markerPalette).toEqual(MARKER_PRESETS)
  })
})

describe('Settings → Colours', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    for (const t of [...toasts.items]) toasts.dismiss(t.id)
  })

  function open() {
    const s = store()
    render(SettingsDialog, { props: { store: s, onclose: () => {}, category: 'colours' } })
    return s
  }
  const group = (name: string) => screen.getByRole('group', { name })

  it('shows the pen and marker palettes, six colours each', () => {
    open()
    expect(within(group('Pen colours')).getAllByRole('button')).toHaveLength(6)
    expect(within(group('Marker colours')).getAllByRole('button')).toHaveLength(6)
    expect(screen.queryByLabelText('Pick a colour from the page')).toBeNull()
  })

  it('clicking a colour opens the editor; a typed hex code changes it at once', async () => {
    const s = open()
    const swatch = within(group('Pen colours')).getAllByRole('button')[1]
    await fireEvent.click(swatch)
    expect(swatch.getAttribute('aria-pressed')).toBe('true')
    const hex = screen.getByLabelText('Hex code') as HTMLInputElement
    expect(hex.value).toBe('#e53935')
    expect(screen.getByLabelText('Colour 2')).toHaveProperty('type', 'color')
    await fireEvent.input(hex, { target: { value: '#00ff00' } })
    expect(s.data.preferences.penPalette[1]).toEqual([0, 1, 0])
    expect(s.data.preferences.penPalette[0]).toEqual(PEN_PRESETS[0])
    await fireEvent.click(swatch)
    expect(screen.queryByLabelText('Hex code')).toBeNull()
  })

  it('Reset is off for the built-in colours, puts them back, and its toast can undo it', async () => {
    const s = open()
    const reset = () => screen.getAllByRole('button', { name: 'Reset' })[1] as HTMLButtonElement
    expect(reset().disabled).toBe(true)
    s.setPaletteColor('markerPalette', 0, RED)
    await vi.advanceTimersByTimeAsync(0)
    expect(reset().disabled).toBe(false)
    await fireEvent.click(reset())
    expect(s.data.preferences.markerPalette).toEqual(MARKER_PRESETS)
    const toast = toasts.items.at(-1)!
    expect(toast.message).toBe('Marker colours reset')
    toast.action!.run()
    expect(s.data.preferences.markerPalette[0]).toEqual(RED)
  })
})

describe('tool options use the palettes', () => {
  const GREEN: RGB = [0, 1, 0]
  afterEach(() => {
    settings.resetPalette('penPalette')
    settings.resetPalette('markerPalette')
  })
  const swatches = (container: HTMLElement) => [...container.querySelectorAll('[role="radio"]')].map((b) => b.getAttribute('aria-label'))
  const noop = () => {}

  it('pen, underline/strike-out, text boxes and shapes show the pen palette', () => {
    settings.setPaletteColor('penPalette', 0, GREEN)
    for (const [C, props] of [
      [PenControls, { value: { color: RED, width: 2, opacity: 1 } }],
      [TextLineControls, { value: { color: RED } }],
    ] as const) {
      const { container, unmount } = render(C, { props: { ...props, onchange: noop, oncommit: noop } as never })
      expect(swatches(container)[0]).toBe('#00ff00')
      unmount()
    }
    const text = render(TextControls, {
      props: { value: { fontSize: 12, textColor: RED, background: { color: RED, opacity: 1 }, align: 'left' }, onchange: noop, oncommit: noop } as never,
    })
    // Text colour and background.
    expect(text.container.querySelectorAll('[aria-label="#00ff00"]')).toHaveLength(2)
    text.unmount()
    const shape = render(StyleControls, {
      props: { style: { border: { color: RED, width: 1, opacity: 1 }, fill: { color: RED, opacity: 1 } }, onchange: noop, oncommit: noop } as never,
    })
    // Border and fill.
    expect(shape.container.querySelectorAll('[aria-label="#00ff00"]')).toHaveLength(2)
    shape.unmount()
  })

  it('the marker shows the marker palette, and follows a change at once', async () => {
    const { container } = render(MarkerControls, { props: { value: { color: RED, opacity: 1 }, onchange: noop, oncommit: noop } as never })
    expect(swatches(container)[0]).toBe('#ffeb3b')
    settings.setPaletteColor('markerPalette', 0, GREEN)
    await vi.waitFor(() => expect(swatches(container)[0]).toBe('#00ff00'))
  })
})

describe('ColorPicker with a user palette', () => {
  it('shows the same colour twice', () => {
    const { getAllByRole } = render(ColorPicker, { props: { value: RED, presets: six(RED), onchange: () => {} } })
    expect(getAllByRole('radio')).toHaveLength(6)
  })
})
