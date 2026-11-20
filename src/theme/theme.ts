import type { Theme } from '../core/settings/preferences'

/** The palette in use: the `data-theme` value on the root element (tokens.css). */
export type AppliedTheme = 'dark' | 'light'

/** Matches while Windows is set to the light app mode (WebView2 follows it). */
export const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)'

export function resolveTheme(theme: Theme, systemLight: boolean): AppliedTheme {
  if (theme === 'system') return systemLight ? 'light' : 'dark'
  return theme
}

/**
 * Keeps `root`'s `data-theme` in line with the theme preference. Switching
 * only swaps CSS variables, so nothing (in particular no PDF page) re-renders.
 * `apply` reads `theme()`, so calling it from an effect re-applies on every
 * change; a change of the Windows theme re-applies on its own (it only makes a
 * difference for 'system').
 */
export function createThemeSync(
  root: HTMLElement,
  theme: () => Theme,
  media: MediaQueryList | null = typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_LIGHT_QUERY) : null,
): { apply(): void; dispose(): void } {
  const apply = () => {
    const next = resolveTheme(theme(), media?.matches ?? false)
    if (root.dataset.theme !== next) root.dataset.theme = next
  }
  media?.addEventListener('change', apply)
  return { apply, dispose: () => media?.removeEventListener('change', apply) }
}
