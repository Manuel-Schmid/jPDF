/**
 * What Settings → AI tells a user whose CLI is missing or not signed in:
 * what the tool is, how to install it and how to sign in. Commands and pages
 * as the providers document them (Claude Code: code.claude.com/docs/en/setup;
 * Codex: github.com/openai/codex).
 */
import type { CliInfo, CliKind } from './cliIpc'

export interface CliSetup {
  /** One sentence: what the tool is for here and which plan it needs. */
  about: string
  /** PowerShell command that installs it. */
  install: string
  /** How to sign in after installing. */
  signIn: string
  /** The provider's install page. */
  docs: string
}

export const CLI_SETUP: Record<CliKind, CliSetup> = {
  claude: {
    about: 'Claude Code writes the explanations with your own Claude subscription (Pro or higher; the free plan does not include it).',
    install: 'irm https://claude.ai/install.ps1 | iex',
    signIn: 'Open a new terminal, run claude and follow the sign-in steps in your browser.',
    docs: 'https://code.claude.com/docs/en/setup',
  },
  codex: {
    about: 'Codex writes the explanations with your own ChatGPT subscription (Plus or higher).',
    install: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
    signIn: 'Open a new terminal, run codex and choose "Sign in with ChatGPT".',
    docs: 'https://github.com/openai/codex',
  },
}

/**
 * The PowerShell command that signs a found but signed-out Claude Code in.
 * The desktop app's copy is not on PATH, so it is called by its full path.
 */
export function signInCommand(info: CliInfo): string {
  return info.desktop && info.path ? `& "${info.path}" auth login` : 'claude auth login'
}
