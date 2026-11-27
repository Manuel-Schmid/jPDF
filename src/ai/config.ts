/**
 * The CLI settings as one object. Kept apart from cliGenerator.ts on purpose:
 * the status bar (loaded eagerly) needs this, and cliGenerator.ts must only
 * load once AI is actually used. Type-only imports keep this file free of code.
 */
import type { Preferences } from '../core/settings/preferences'
import type { CliConfig } from './cliIpc'

/** The CLI, its executable, model, effort and (Claude) saved sign-in token as chosen in the preferences. */
export function cliConfigOf(p: Preferences): CliConfig {
  return p.aiCli === 'codex'
    ? { cli: 'codex', path: p.aiCodexPath, model: p.aiCodexModel, effort: p.aiCodexEffort, token: '' }
    : { cli: 'claude', path: p.aiClaudePath, model: p.aiClaudeModel, effort: p.aiClaudeEffort, token: p.aiClaudeToken }
}
