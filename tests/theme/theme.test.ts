import { describe, expect, it } from 'vitest'
import type { Theme } from '../../src/core/settings/preferences'
import { createThemeSync, resolveTheme } from '../../src/theme/theme'

/** A MediaQueryList for prefers-color-scheme whose `matches` the test flips. */
function fakeMedia(light: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: light,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  return {
    media: media as unknown as MediaQueryList,
    listeners,
    setLight(v: boolean) {
      media.matches = v
      listeners.forEach((l) => l())
    },
  }
}

describe('resolveTheme', () => {
  it('maps the preference to the palette', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })
})

describe('createThemeSync', () => {
  it('switching the theme swaps the root attribute', () => {
    const root = document.createElement('div')
    let theme: Theme = 'dark'
    const sync = createThemeSync(root, () => theme, fakeMedia(true).media)
    sync.apply()
    expect(root.dataset.theme).toBe('dark')
    theme = 'light'
    sync.apply()
    expect(root.dataset.theme).toBe('light')
    theme = 'dark'
    sync.apply()
    expect(root.dataset.theme).toBe('dark')
  })

  it('Follow Windows reacts to a change of the Windows theme', () => {
    const root = document.createElement('div')
    const m = fakeMedia(false)
    let theme: Theme = 'system'
    const sync = createThemeSync(root, () => theme, m.media)
    sync.apply()
    expect(root.dataset.theme).toBe('dark')
    m.setLight(true)
    expect(root.dataset.theme).toBe('light')
    // A fixed choice ignores Windows.
    theme = 'dark'
    sync.apply()
    m.setLight(true)
    expect(root.dataset.theme).toBe('dark')
  })

  it('dispose stops listening to Windows', () => {
    const m = fakeMedia(false)
    const sync = createThemeSync(document.createElement('div'), () => 'system', m.media)
    expect(m.listeners.size).toBe(1)
    sync.dispose()
    expect(m.listeners.size).toBe(0)
  })

  it('without matchMedia, Follow Windows is dark', () => {
    const root = document.createElement('div')
    createThemeSync(root, () => 'system', null).apply()
    expect(root.dataset.theme).toBe('dark')
  })
})
