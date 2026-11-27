import { SIDEBAR_WIDTH } from '../viewer/thumbnailList'
import { DEFAULT_PEN_BUTTONS, PEN_BUTTON_ACTIONS } from '../../tools/rightClick'
import type { RGB } from '../session/model'
import { PEN_PRESETS } from '../../tools/pen/settings'
import { MARKER_PRESETS } from '../../tools/marker/settings'

/** Dark (the default), Light, or follow the Windows app theme. */
export const THEMES = ['dark', 'light', 'system'] as const
export type Theme = (typeof THEMES)[number]

/** The window edge the toolbar sits at; right is the default. */
export const TOOLBAR_POSITIONS = ['right', 'left', 'top', 'bottom'] as const
export type ToolbarPosition = (typeof TOOLBAR_POSITIONS)[number]

/** Where a reopened file opens: where it was left (the default) or at its first page. */
export const REOPEN_AT = ['last', 'start'] as const
export type ReopenAt = (typeof REOPEN_AT)[number]

/**
 * How PDF pages are shown: as they are (the default), dark (inverted for
 * reading at night), or dark only while the app theme is dark. Display only:
 * the file never changes.
 */
export const PAGE_COLORS = ['original', 'dark', 'theme'] as const
export type PageColors = (typeof PAGE_COLORS)[number]

interface Preference<T> {
  default: T
  /** Whether a stored value is usable; anything else falls back to the default. */
  accepts(v: unknown): v is T
}

function flag(fallback: boolean): Preference<boolean> {
  return { default: fallback, accepts: (v): v is boolean => typeof v === 'boolean' }
}

function between(min: number, max: number, fallback: number): Preference<number> {
  return { default: fallback, accepts: (v): v is number => typeof v === 'number' && v >= min && v <= max }
}

/** Free text up to `max` characters (a model name, an executable path). */
function text(fallback: string, max = 500): Preference<string> {
  return { default: fallback, accepts: (v): v is string => typeof v === 'string' && v.length <= max }
}

/** Colours in every palette (Settings → Colours); the tool options show them plus the custom colour. */
export const PALETTE_SIZE = 6

const isChannel = (c: unknown) => typeof c === 'number' && c >= 0 && c <= 1
const isRgb = (v: unknown): v is RGB => Array.isArray(v) && v.length === 3 && v.every(isChannel)

/** Exactly PALETTE_SIZE colours, each an RGB with channels in 0..1. */
function palette(fallback: readonly RGB[]): Preference<RGB[]> {
  return {
    default: fallback.map((c) => [...c] as RGB),
    accepts: (v): v is RGB[] => Array.isArray(v) && v.length === PALETTE_SIZE && v.every(isRgb),
  }
}

/** A chord as `chordFromEvent` writes it: optional Ctrl, Alt, Shift (in that order), then a key. */
const CHORD = /^(Ctrl\+)?(Alt\+)?(Shift\+)?[^+]+$/

/**
 * Changed keyboard shortcuts (Settings → Shortcuts): command id → its keys
 * (empty: no shortcut). Only changed commands are stored, so later versions'
 * new defaults still reach a user who changed others.
 */
function shortcutOverrides(): Preference<Record<string, string[]>> {
  const isChord = (c: unknown) => typeof c === 'string' && c.length <= 40 && CHORD.test(c)
  return {
    default: {},
    accepts: (v): v is Record<string, string[]> =>
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v).length <= 500 &&
      Object.values(v).every((cs) => Array.isArray(cs) && cs.length <= 8 && cs.every(isChord)),
  }
}

function oneOf<T extends string>(values: readonly T[], fallback: T): Preference<T> {
  return { default: fallback, accepts: (v): v is T => values.includes(v as T) }
}

/**
 * The app-wide preferences shown in the settings dialog, saved under
 * `preferences` in settings.json.
 *
 * Adding an option means adding one entry here: its default and which stored
 * values it accepts. The `Preferences` type, loading (an absent or invalid
 * value becomes the default, so older files need no migration) and saving
 * follow from it; the dialog then gets a control for it.
 */
export const PREFERENCES = {
  theme: oneOf(THEMES, 'dark'),
  toolbarPosition: oneOf(TOOLBAR_POSITIONS, 'right'),
  reopenAt: oneOf(REOPEN_AT, 'last'),
  pageColors: oneOf(PAGE_COLORS, 'original'),
  /** Whether the page thumbnail sidebar is open (toggled from the status bar, Ctrl+B or F4, not the dialog). */
  thumbnails: flag(false),
  /** Width (CSS px) of the thumbnail sidebar, dragged at its inner edge (not the dialog). */
  thumbnailWidth: between(SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max, SIDEBAR_WIDTH.initial),
  /** Look for a new version on GitHub a few seconds after startup (Settings → Updates). */
  checkUpdates: flag(true),
  /** Whether one finger on a touchscreen draws with the active tool instead of scrolling (Settings → Toolbar). */
  drawWithFinger: flag(false),
  /** What holding the pen's side (barrel) button does (Settings → Toolbar; see PenButtonAction). */
  penSideButton: oneOf(PEN_BUTTON_ACTIONS, DEFAULT_PEN_BUTTONS.side),
  /** What the pen's eraser end, or a second button reported as one, does (Settings → Toolbar). */
  penEraserButton: oneOf(PEN_BUTTON_ACTIONS, DEFAULT_PEN_BUTTONS.end),
  /** Page explanations through a local AI CLI (Settings → AI); off until the user turns it on. */
  aiEnabled: flag(false),
  aiCli: oneOf(['claude', 'codex'], 'claude'),
  aiClaudeModel: text('opus', 200),
  aiClaudeEffort: text('medium', 20),
  /** Empty: the CLI's own default model. */
  aiCodexModel: text('', 200),
  aiCodexEffort: text('medium', 20),
  /** Which pages get a picture besides their text: those where it helps (diagrams, scans), or every page. */
  aiPictures: oneOf<'useful' | 'all'>(['useful', 'all'], 'useful'),
  /** Empty: find the CLI on PATH and in its usual install folders. */
  aiClaudePath: text(''),
  aiCodexPath: text(''),
  /**
   * Claude's long-lived sign-in token (`claude setup-token`, valid for a
   * year): handed only to the Claude CLI that JuliePDF starts, as
   * CLAUDE_CODE_OAUTH_TOKEN, so the user need not sign in again. Empty: the
   * CLI's own sign-in.
   */
  aiClaudeToken: text(''),
  /**
   * Preset colours of the pen, text boxes (text and background), underline,
   * strike-out, shapes and lines (Settings → Colours).
   */
  penPalette: palette(PEN_PRESETS),
  /** Preset colours of the marker (Settings → Colours). */
  markerPalette: palette(MARKER_PRESETS),
  /** Keyboard shortcuts the user changed (Settings → Shortcuts; see shortcuts.ts). */
  shortcutOverrides: shortcutOverrides(),
} satisfies Record<string, Preference<unknown>>

export type Preferences = { [K in keyof typeof PREFERENCES]: (typeof PREFERENCES)[K]['default'] }

export function defaultPreferences(): Preferences {
  return readPreferences(undefined)
}

/** The stored preferences, each unknown or invalid value replaced by its default. */
export function readPreferences(stored: unknown): Preferences {
  const o = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const [key, pref] of Object.entries(PREFERENCES) as [string, Preference<unknown>][]) {
    // A copy of an object default (a palette), so no settings object shares it.
    out[key] = pref.accepts(o[key]) ? o[key] : typeof pref.default === 'object' ? structuredClone(pref.default) : pref.default
  }
  return out as Preferences
}
