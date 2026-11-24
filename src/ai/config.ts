/** The AI endpoint configured in Settings → AI (see the `ai*` preferences). */
import type { Preferences } from '../core/settings/preferences'
import type { AiConfig } from './ipc'

export function aiConfigOf(p: Pick<Preferences, 'aiProvider' | 'aiBaseUrl' | 'aiModel'>): AiConfig {
  return { provider: p.aiProvider, baseUrl: p.aiBaseUrl, model: p.aiModel }
}
