/** Backend calls of the local AI CLIs (Rust `ai` module: Claude Code and Codex). */
import { Channel, invoke } from '@tauri-apps/api/core'
import type { PagePicture } from './pictures/render'

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
  /** Claude only: whether it is signed in (`claude auth status`); null when unknown. */
  signedIn: boolean | null
  /** The copy inside the Claude desktop app (found there, signed in only inside the app until signed in once outside). */
  desktop: boolean
}

export interface CliModel {
  value: string
  label: string
  description: string
  efforts: string[]
  isDefault: boolean
  /** Whether the model can read page pictures. */
  images: boolean
}

export type CliOutcome = 'done' | 'truncated' | 'cancelled'

/** The backend's answer: how the run ended and how many lines it sent on the channel. */
interface Generated {
  outcome: CliOutcome
  lines: number
}

/** How long to wait for channel lines that the command's answer overtook. */
export const LINE_WAIT_MS = 2000

/** Looks for the CLI (custom path first); never rejects. */
export function cliInfo(cli: CliKind, customPath: string): Promise<CliInfo> {
  return invoke<CliInfo>('ai_cli_info', { cli, customPath })
}

/** The models the CLI offers; rejects with `{ code: 'AiCli', message }` when it cannot list them. */
export function cliModels(cli: CliKind, customPath: string): Promise<CliModel[]> {
  return invoke<CliModel[]>('ai_cli_models', { cli, customPath })
}

/**
 * Streams one answer; `onLine` gets every complete line as it arrives.
 * Channel messages and the command's answer travel separately, so the answer
 * can arrive before the last lines: it resolves only once all `lines` the
 * backend sent came in, or after LINE_WAIT_MS at the latest. Lines that
 * straggle in later still are dropped, since the caller has moved on.
 */
export async function cliGenerate(
  requestId: number,
  config: CliConfig,
  system: string,
  user: string,
  images: readonly PagePicture[],
  onLine: (line: string) => void,
): Promise<CliOutcome> {
  const channel = new Channel<string>()
  let received = 0
  let settled = false
  let allIn: (() => void) | null = null
  let expected = Infinity
  channel.onmessage = (line) => {
    if (settled) return
    received++
    onLine(line)
    if (received >= expected) allIn?.()
  }
  try {
    const { outcome, lines } = await invoke<Generated>('ai_cli_generate', {
      requestId, config, system, user, images, onLine: channel,
    })
    if (received < lines) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LINE_WAIT_MS)
        expected = lines
        allIn = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
    return outcome
  } finally {
    settled = true
  }
}

export function cliCancel(requestId: number): Promise<void> {
  return invoke<void>('ai_cli_cancel', { requestId })
}
