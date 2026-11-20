import { describe, expect, it } from 'vitest'
import { PREFERENCES, THEMES, defaultPreferences, readPreferences } from '../../../src/core/settings/preferences'

describe('preferences', () => {
  it('defaults: dark theme', () => {
    expect(defaultPreferences()).toEqual({ theme: 'dark' })
  })

  it('every default is a value its preference accepts', () => {
    for (const p of Object.values(PREFERENCES)) expect(p.accepts(p.default)).toBe(true)
  })

  it('reads every valid theme and drops unknown keys', () => {
    for (const theme of THEMES) expect(readPreferences({ theme, other: 1 })).toEqual({ theme })
  })

  it('falls back per field for missing or invalid values', () => {
    for (const stored of [undefined, null, 7, 'light', [], {}, { theme: 'Light' }, { theme: null }]) {
      expect(readPreferences(stored)).toEqual({ theme: 'dark' })
    }
  })
})
