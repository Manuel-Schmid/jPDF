/** The AI endpoints configured in Settings → AI (see the `ai*` preferences). */
import type { Preferences } from '../core/settings/preferences'
import type { AiConfig } from './ipc'

export function aiConfigOf(p: Pick<Preferences, 'aiProvider' | 'aiBaseUrl' | 'aiModel'>): AiConfig {
  return { provider: p.aiProvider, baseUrl: p.aiBaseUrl, model: p.aiModel }
}

/**
 * The backup provider, or null when there is none: not chosen, the same
 * preset as the main provider (it would share its key and its outage), or
 * without a URL or model.
 */
export function backupConfigOf(
  p: Pick<Preferences, 'aiProvider' | 'aiBackupProvider' | 'aiBackupBaseUrl' | 'aiBackupModel'>,
): AiConfig | null {
  const provider = p.aiBackupProvider
  if (provider === 'none' || provider === p.aiProvider) return null
  if (!p.aiBackupBaseUrl.trim() || !p.aiBackupModel.trim()) return null
  return { provider, baseUrl: p.aiBackupBaseUrl, model: p.aiBackupModel }
}
