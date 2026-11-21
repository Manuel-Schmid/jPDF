import { describe, expect, it } from 'vitest'
import { PREFERENCES, THEMES, TOOLBAR_POSITIONS, defaultPreferences, readPreferences } from '../../../src/core/settings/preferences'

describe('preferences', () => {
  it('defaults: dark theme, toolbar on the right, reopen where left off, thumbnails closed', () => {
    expect(defaultPreferences()).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', thumbnails: false })
  })

  it('every default is a value its preference accepts', () => {
    for (const p of Object.values(PREFERENCES)) expect(p.accepts(p.default)).toBe(true)
  })

  it('reads every valid theme and drops unknown keys', () => {
    for (const theme of THEMES) expect(readPreferences({ theme, other: 1 })).toEqual({ theme, toolbarPosition: 'right', reopenAt: 'last', thumbnails: false })
  })

  it('falls back per field for missing or invalid values', () => {
    for (const stored of [undefined, null, 7, 'light', [], {}, { theme: 'Light' }, { theme: null }]) {
      expect(readPreferences(stored)).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', thumbnails: false })
    }
  })

  it('reads every toolbar position; an unknown one falls back to right', () => {
    for (const toolbarPosition of TOOLBAR_POSITIONS) {
      expect(readPreferences({ toolbarPosition, reopenAt: 'last', thumbnails: false })).toEqual({ theme: 'dark', toolbarPosition, reopenAt: 'last', thumbnails: false })
    }
    for (const toolbarPosition of ['Top', 'center', 1, null]) {
      expect(readPreferences({ theme: 'light', toolbarPosition, reopenAt: 'last', thumbnails: false })).toEqual({ theme: 'light', toolbarPosition: 'right', reopenAt: 'last', thumbnails: false })
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
