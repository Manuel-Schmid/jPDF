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

/** How the desktop app's copy (not on PATH) is called in PowerShell: by its full path. */
function claudeCommand(info: CliInfo | null): string {
  return info?.desktop && info.path ? `& "${info.path}"` : 'claude'
}

/**
 * The PowerShell command that signs a found but signed-out Claude Code in
 * the usual way (the sign-in may expire; the token below lasts a year).
 */
export function signInCommand(info: CliInfo): string {
  return `${claudeCommand(info)} auth login`
}

/**
 * The PowerShell command that makes a sign-in token valid for a year
 * (`claude setup-token`: the same browser sign-in, then the token is
 * printed). JuliePDF keeps it and hands it to Claude Code, so the user does
 * not have to sign in again. `info` null: not installed yet (it will be on PATH).
 */
export function setupTokenCommand(info: CliInfo | null): string {
  return `${claudeCommand(info)} setup-token`
}

/** Whether `text` looks like a Claude token (they start with `sk-ant-`); only a hint, never a block. */
export function looksLikeClaudeToken(text: string): boolean {
  return text.trim().startsWith('sk-ant-')
}
