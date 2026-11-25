import { describe, expect, it } from 'vitest'
import { PAGE_COLORS, PREFERENCES, THEMES, TOOLBAR_POSITIONS, defaultPreferences, readPreferences } from '../../../src/core/settings/preferences'

const AI = { aiEnabled: false, aiCli: 'claude', aiClaudeModel: 'opus', aiClaudeEffort: 'medium', aiCodexModel: '', aiCodexEffort: 'medium', aiPictures: 'useful', aiClaudePath: '', aiCodexPath: '' }

describe('preferences', () => {
  it('defaults: dark theme, toolbar on the right, reopen where left off, original page colours, thumbnails closed, update checks on, drawWithFinger off', () => {
    expect(defaultPreferences()).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, drawWithFinger: false, ...AI })
  })

  it('every default is a value its preference accepts', () => {
    for (const p of Object.values(PREFERENCES)) expect(p.accepts(p.default)).toBe(true)
  })

  it('reads every valid theme and drops unknown keys', () => {
    for (const theme of THEMES) expect(readPreferences({ theme, other: 1 })).toEqual({ theme, toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, drawWithFinger: false, ...AI })
  })

  it('falls back per field for missing or invalid values', () => {
    for (const stored of [undefined, null, 7, 'light', [], {}, { theme: 'Light' }, { theme: null }]) {
      expect(readPreferences(stored)).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, drawWithFinger: false, ...AI })
    }
  })

  it('reads every toolbar position; an unknown one falls back to right', () => {
    for (const toolbarPosition of TOOLBAR_POSITIONS) {
      expect(readPreferences({ toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, ...AI })).toEqual({ theme: 'dark', toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, drawWithFinger: false, ...AI })
    }
    for (const toolbarPosition of ['Top', 'center', 1, null]) {
      expect(readPreferences({ theme: 'light', toolbarPosition, reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, ...AI })).toEqual({ theme: 'light', toolbarPosition: 'right', reopenAt: 'last', pageColors: 'original', thumbnails: false, thumbnailWidth: 160, checkUpdates: true, drawWithFinger: false, ...AI })
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
    expect(readPreferences({ checkUpdates: true, ...AI }).checkUpdates).toBe(true)
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

describe('thumbnail sidebar width preference', () => {
  it('keeps a stored width within the draggable range; anything else is the default', () => {
    expect(readPreferences({ thumbnailWidth: 240 }).thumbnailWidth).toBe(240)
    expect(readPreferences({ thumbnailWidth: 120 }).thumbnailWidth).toBe(120)
    for (const thumbnailWidth of [60, 1000, '240', null, Number.NaN]) {
      expect(readPreferences({ thumbnailWidth }).thumbnailWidth).toBe(160)
    }
  })
})

describe('AI preferences', () => {
  it('an unknown CLI falls back to claude; a known one is kept', () => {
    expect(readPreferences({ aiCli: 'gemini' }).aiCli).toBe('claude')
    expect(readPreferences({ aiCli: 'codex' }).aiCli).toBe('codex')
  })

  it('text values keep strings up to their limit; longer or non-strings fall back', () => {
    expect(readPreferences({ aiClaudeModel: 'sonnet' }).aiClaudeModel).toBe('sonnet')
    expect(readPreferences({ aiClaudeModel: 'x'.repeat(201) }).aiClaudeModel).toBe('opus')
    expect(readPreferences({ aiClaudeEffort: 'x'.repeat(21) }).aiClaudeEffort).toBe('medium')
    expect(readPreferences({ aiCodexPath: 'C:/bin/codex.exe' }).aiCodexPath).toBe('C:/bin/codex.exe')
    expect(readPreferences({ aiCodexPath: 'x'.repeat(501) }).aiCodexPath).toBe('')
    expect(readPreferences({ aiCodexModel: 5 }).aiCodexModel).toBe('')
  })
})

describe('aiPictures preference', () => {
  it('aiPictures defaults to useful', () => {
    expect(defaultPreferences().aiPictures).toBe('useful')
  })
  it('accepts all, and falls back to useful for anything else', () => {
    expect(readPreferences({ aiPictures: 'all' }).aiPictures).toBe('all')
    for (const bad of ['every', 1, null, true]) expect(readPreferences({ aiPictures: bad }).aiPictures).toBe('useful')
  })
})

describe('drawWithFinger preference', () => {
  it('is off by default; only a boolean is kept', () => {
    expect(defaultPreferences().drawWithFinger).toBe(false)
    expect(readPreferences({ drawWithFinger: true }).drawWithFinger).toBe(true)
    expect(readPreferences({ drawWithFinger: false }).drawWithFinger).toBe(false)
    for (const drawWithFinger of ['true', 1, null, {}]) expect(readPreferences({ drawWithFinger }).drawWithFinger).toBe(false)
  })
})
