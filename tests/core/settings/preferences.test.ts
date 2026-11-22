import { describe, expect, it } from 'vitest'
import { PAGE_COLORS, PREFERENCES, THEMES, TOOLBAR_POSITIONS, defaultPreferences, readPreferences } from '../../../src/core/settings/preferences'

describe('preferences', () => {
  it('defaults: dark theme, toolbar on the right, reopen where left off, original page colours, thumbnails closed, update checks on', () => {
    expect(defaultPreferences()).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })
  })

  it('every default is a value its preference accepts', () => {
    for (const p of Object.values(PREFERENCES)) expect(p.accepts(p.default)).toBe(true)
  })

  it('reads every valid theme and drops unknown keys', () => {
    for (const theme of THEMES) expect(readPreferences({ theme, other: 1 })).toEqual({ theme, toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })
  })

  it('falls back per field for missing or invalid values', () => {
    for (const stored of [undefined, null, 7, 'light', [], {}, { theme: 'Light' }, { theme: null }]) {
      expect(readPreferences(stored)).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })
    }
  })

  it('reads every toolbar position; an unknown one falls back to right', () => {
    for (const toolbarPosition of TOOLBAR_POSITIONS) {
      expect(readPreferences({ toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })).toEqual({ theme: 'dark', toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })
    }
    for (const toolbarPosition of ['Top', 'center', 1, null]) {
      expect(readPreferences({ theme: 'light', toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })).toEqual({ theme: 'light', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, checkUpdates: true })
    }
  })
})

describe('thumbnails preference', () => {
  it('keeps a stored boolean; anything else is closed', () => {
    expect(readPreferences({ thumbnails: true }).thumbnails).toBe(true)
    expect(readPreferences({ thumbnails: false }).thumbnails).toBe(false)
    for (const thumbnails of ['true', 1, null, {}]) expect(readPreferences({ thumbnails }).thumbnails).toBe(false)
  })
})

describe('checkUpdates preference', () => {
  it('is on by default; only a boolean is kept', () => {
    expect(readPreferences({ checkUpdates: false }).checkUpdates).toBe(false)
    expect(readPreferences({ checkUpdates: true }).checkUpdates).toBe(true)
    for (const checkUpdates of ['false', 0, null, {}]) expect(readPreferences({ checkUpdates }).checkUpdates).toBe(true)
  })
})

describe('pageColors preference', () => {
  it('is original by default; keeps every valid value, anything else is original', () => {
    expect(defaultPreferences().pageColors).toBe('original')
    for (const pageColors of PAGE_COLORS) expect(readPreferences({ pageColors }).pageColors).toBe(pageColors)
    for (const pageColors of ['Dark', 'inverted', 1, null, true]) expect(readPreferences({ pageColors }).pageColors).toBe('original')
  })
})
