import { fireEvent, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ColorPicker from '../../src/ui/ColorPicker.svelte'
import { hexToRgb, parseHex, rgbToHex } from '../../src/ui/color'
import type { RGB } from '../../src/core/session/model'
import { cancelPick, eyedropper, registerColorSource } from '../../src/core/viewer/eyedropper.svelte'

const presets: RGB[] = [[1, 0.922, 0.231], [0, 0, 1], [0.1, 0.1, 0.1]]

describe('ColorPicker', () => {
  it('clicking preset emits its RGB', async () => {
    const onchange = vi.fn()
    const { getAllByRole } = render(ColorPicker, { props: { value: presets[0], presets, onchange } })
    const swatches = getAllByRole('radio')
    expect(swatches).toHaveLength(3)
    await fireEvent.click(swatches[1])
    expect(onchange).toHaveBeenCalledWith([0, 0, 1])
  })

  it('marks the preset matching the value as checked', () => {
    const { getAllByRole } = render(ColorPicker, { props: { value: [0, 0, 1], presets, onchange: () => {} } })
    expect(getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  afterEach(() => cancelPick())

  it('custom hex #ff0000 emits [1,0,0]', async () => {
    const onchange = vi.fn()
    const { getByLabelText, queryByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange } })
    expect(queryByLabelText('Custom colour')).toBeNull()
    const toggle = getByLabelText('Custom colours')
    await fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const input = getByLabelText('Custom colour') as HTMLInputElement
    expect(input.type).toBe('color')
    await fireEvent.input(input, { target: { value: '#ff0000' } })
    expect(onchange).toHaveBeenCalledWith([1, 0, 0])
  })

  it('the hex field shows the current colour and applies a typed code', async () => {
    const onchange = vi.fn()
    const oncommit = vi.fn()
    const { getByLabelText } = render(ColorPicker, { props: { value: [0, 0, 1], presets, onchange, oncommit } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const hex = getByLabelText('Hex code') as HTMLInputElement
    expect(hex.value).toBe('#0000ff')
    await fireEvent.input(hex, { target: { value: '#ff00' } })
    expect(onchange).not.toHaveBeenCalled()
    expect(hex.getAttribute('aria-invalid')).toBe('true')
    await fireEvent.input(hex, { target: { value: 'f00' } })
    expect(onchange).toHaveBeenLastCalledWith([1, 0, 0])
    expect(hex.getAttribute('aria-invalid')).toBe('false')
    expect(oncommit).not.toHaveBeenCalled()
    await fireEvent.change(hex)
    await fireEvent.blur(hex)
    expect(oncommit).toHaveBeenCalledOnce()
    expect(oncommit).toHaveBeenCalledWith([1, 0, 0])
  })

  it('an invalid code goes back to the current colour on leaving the field', async () => {
    const onchange = vi.fn()
    const oncommit = vi.fn()
    const { getByLabelText } = render(ColorPicker, { props: { value: [0, 0, 1], presets, onchange, oncommit } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const hex = getByLabelText('Hex code') as HTMLInputElement
    await fireEvent.input(hex, { target: { value: 'nope' } })
    await fireEvent.blur(hex)
    expect(hex.value).toBe('#0000ff')
    expect(onchange).not.toHaveBeenCalled()
    expect(oncommit).not.toHaveBeenCalled()
  })

  it('clicking the colour well again closes its dialog instead of reopening it', async () => {
    const { getByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange: () => {} } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const well = getByLabelText('Custom colour')
    expect(await fireEvent.click(well)).toBe(true) // opens
    expect(well.closest('.well')?.classList.contains('open')).toBe(true)
    expect(await fireEvent.click(well)).toBe(false) // closes: default prevented
    expect(well.closest('.well')?.classList.contains('open')).toBe(false)
    expect(await fireEvent.click(well)).toBe(true) // opens again
  })

  it('a click right after the dialog closed (window focus back) does not reopen it', async () => {
    const { getByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange: () => {} } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const well = getByLabelText('Custom colour')
    await fireEvent.click(well)
    window.dispatchEvent(new FocusEvent('focus'))
    expect(await fireEvent.click(well)).toBe(false)
    expect(await fireEvent.click(well)).toBe(true)
  })

  it('a selected custom colour keeps a palette badge on its swatch', async () => {
    const { getByLabelText } = render(ColorPicker, { props: { value: [0.3, 0.1, 0.5], presets, onchange: () => {} } })
    const toggle = getByLabelText('Custom colours')
    expect(toggle.classList.contains('checked')).toBe(true)
    expect(toggle.querySelector('.badge svg')?.classList.contains('lucide-palette')).toBe(true)
  })

  it('the custom colour button shows a palette, not a pipette', () => {
    const { getByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange: () => {} } })
    expect(getByLabelText('Custom colours').querySelector('svg')?.classList.contains('lucide-palette')).toBe(true)
  })

  it('the eyedropper applies the colour picked on a page like a preset', async () => {
    const page = document.createElement('div')
    document.body.append(page)
    page.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
    const stop = registerColorSource(page, () => [0.2, 0.4, 0.6])
    const onchange = vi.fn()
    const oncommit = vi.fn()
    const { getByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange, oncommit } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const dropper = getByLabelText('Pick a colour from the page')
    await fireEvent.click(dropper)
    expect(eyedropper.active).toBe(true)
    expect(dropper.getAttribute('aria-pressed')).toBe('true')
    page.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 50, bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(oncommit).toHaveBeenCalledWith([0.2, 0.4, 0.6]))
    expect(onchange).toHaveBeenCalledWith([0.2, 0.4, 0.6])
    expect(eyedropper.active).toBe(false)
    stop()
    page.remove()
  })

  it('pressing the eyedropper again cancels the pick', async () => {
    const onchange = vi.fn()
    const { getByLabelText } = render(ColorPicker, { props: { value: presets[0], presets, onchange } })
    await fireEvent.click(getByLabelText('Custom colours'))
    const dropper = getByLabelText('Pick a colour from the page')
    await fireEvent.click(dropper)
    await fireEvent.pointerDown(dropper)
    await fireEvent.click(dropper)
    await vi.waitFor(() => expect(eyedropper.active).toBe(false))
    expect(onchange).not.toHaveBeenCalled()
  })

  it('unmounting cancels its pick', async () => {
    const { getByLabelText, unmount } = render(ColorPicker, { props: { value: presets[0], presets, onchange: () => {} } })
    await fireEvent.click(getByLabelText('Custom colours'))
    await fireEvent.click(getByLabelText('Pick a colour from the page'))
    expect(eyedropper.active).toBe(true)
    unmount()
    expect(eyedropper.active).toBe(false)
  })
})

describe('hex <-> RGB', () => {
  it('converts both ways', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0])
    expect(hexToRgb('#FFFFFF')).toEqual([1, 1, 1])
    expect(rgbToHex([1, 0.922, 0.231])).toBe('#ffeb3b')
    expect(rgbToHex([0, 0.5, 1])).toBe('#0080ff')
  })

  it('clamps out-of-range channels and rejects bad hex', () => {
    expect(rgbToHex([2, -1, 0])).toBe('#ff0000')
    expect(hexToRgb('red')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })

  it('parses typed or pasted hex codes', () => {
    expect(parseHex('#FF0000')).toEqual([1, 0, 0])
    expect(parseHex('  00ff00 ')).toEqual([0, 1, 0])
    expect(parseHex('#00f')).toEqual([0, 0, 1])
    expect(parseHex('#ff00')).toBeNull()
    expect(parseHex('#gggggg')).toBeNull()
    expect(parseHex('')).toBeNull()
  })

  it('round-trips through hex', () => {
    expect(hexToRgb(rgbToHex([0.2, 0.4, 0.6]))).toEqual([0.2, 0.4, 0.6])
  })
})
