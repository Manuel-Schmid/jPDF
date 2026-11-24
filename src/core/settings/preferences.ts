import { SIDEBAR_WIDTH } from '../viewer/thumbnailList'

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
    out[key] = pref.accepts(o[key]) ? o[key] : pref.default
  }
  return out as Preferences
}
