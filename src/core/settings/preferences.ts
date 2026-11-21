/** Dark (the default), Light, or follow the Windows app theme. */
export const THEMES = ['dark', 'light', 'system'] as const
export type Theme = (typeof THEMES)[number]

/** The window edge the toolbar sits at; right is the default. */
export const TOOLBAR_POSITIONS = ['right', 'left', 'top', 'bottom'] as const
export type ToolbarPosition = (typeof TOOLBAR_POSITIONS)[number]

/** Where a reopened file opens: where it was left (the default) or at its first page. */
export const REOPEN_AT = ['last', 'start'] as const
export type ReopenAt = (typeof REOPEN_AT)[number]

interface Preference<T> {
  default: T
  /** Whether a stored value is usable; anything else falls back to the default. */
  accepts(v: unknown): v is T
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
