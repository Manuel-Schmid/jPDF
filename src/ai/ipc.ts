/** Backend calls of the AI features (Rust `ai` module). */
import { Channel, invoke } from '@tauri-apps/api/core'

/** Where and with which model to generate; `provider` names the stored key. */
export interface AiConfig {
  provider: string
  baseUrl: string
  model: string
}

export type StreamOutcome = 'done' | 'truncated' | 'cancelled'

/** Stores the provider's API key in the Windows Credential Manager (an empty key removes it). */
export function aiSetKey(provider: string, key: string): Promise<void> {
  return invoke<void>('ai_set_key', { provider, key })
}

export function aiHasKey(provider: string): Promise<boolean> {
  return invoke<boolean>('ai_has_key', { provider })
}

/** Checks the stored key against the endpoint (lists its models; uses no generation quota). */
export function aiTest(config: AiConfig): Promise<void> {
  return invoke<void>('ai_test', { config })
}

/** Streams one chat completion; `onLine` gets every complete line of the answer as it arrives. */
export function aiGenerate(
  requestId: number,
  config: AiConfig,
  system: string,
  user: string,
  onLine: (line: string) => void,
): Promise<StreamOutcome> {
  const channel = new Channel<string>()
  channel.onmessage = onLine
  return invoke<StreamOutcome>('ai_generate', { requestId, config, system, user, onLine: channel })
}

export function aiCancel(requestId: number): Promise<void> {
  return invoke<void>('ai_cancel', { requestId })
}
