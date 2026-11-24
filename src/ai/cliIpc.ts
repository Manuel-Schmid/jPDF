/** Backend calls of the local AI CLIs (Rust `ai` module: Claude Code and Codex). */
import { Channel, invoke } from '@tauri-apps/api/core'

export type CliKind = 'claude' | 'codex'

/** Which CLI to run and how; `path` is the resolved executable (or the user's custom one). */
export interface CliConfig {
  cli: CliKind
  path: string
  model: string
  effort: string
}

export interface CliInfo {
  found: boolean
  path: string | null
  version: string | null
}

export interface CliModel {
  value: string
  label: string
  description: string
  efforts: string[]
  isDefault: boolean
}

export type CliOutcome = 'done' | 'truncated' | 'cancelled'

/** Looks for the CLI (custom path first); never rejects. */
export function cliInfo(cli: CliKind, customPath: string): Promise<CliInfo> {
  return invoke<CliInfo>('ai_cli_info', { cli, customPath })
}

/** The models the CLI offers; rejects with `{ code: 'AiCli', message }` when it cannot list them. */
export function cliModels(cli: CliKind, customPath: string): Promise<CliModel[]> {
  return invoke<CliModel[]>('ai_cli_models', { cli, customPath })
}

/** Streams one answer; `onLine` gets every complete line as it arrives. */
export function cliGenerate(
  requestId: number,
  config: CliConfig,
  system: string,
  user: string,
  onLine: (line: string) => void,
): Promise<CliOutcome> {
  const channel = new Channel<string>()
  channel.onmessage = onLine
  return invoke<CliOutcome>('ai_cli_generate', { requestId, config, system, user, onLine: channel })
}

export function cliCancel(requestId: number): Promise<void> {
  return invoke<void>('ai_cli_cancel', { requestId })
}
