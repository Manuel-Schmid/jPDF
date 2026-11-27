import { describe, expect, it } from 'vitest'
import { looksLikeClaudeToken, setupTokenCommand, signInCommand } from '../../src/ai/cliSetup'
import type { CliInfo } from '../../src/ai/cliIpc'

const desktop: CliInfo = { found: true, path: 'C:\\A\\Claude-Data\\c\\claude-code\\2.1.331\\h\\claude.exe', version: '2.1.331', signedIn: false, authMethod: null, desktop: true }
const onPath: CliInfo = { found: true, path: 'C:\\Users\\u\\.local\\bin\\claude.exe', version: '2.1.331', signedIn: false, authMethod: null, desktop: false }

describe('cliSetup commands', () => {
  it("call the desktop app's copy by its full path, others by name", () => {
    expect(setupTokenCommand(desktop)).toBe('& "C:\\A\\Claude-Data\\c\\claude-code\\2.1.331\\h\\claude.exe" setup-token')
    expect(signInCommand(desktop)).toBe('& "C:\\A\\Claude-Data\\c\\claude-code\\2.1.331\\h\\claude.exe" auth login')
    expect(setupTokenCommand(onPath)).toBe('claude setup-token')
    // Not installed yet: the installer puts it on PATH.
    expect(setupTokenCommand(null)).toBe('claude setup-token')
  })

  it('recognises Claude tokens by their prefix', () => {
    expect(looksLikeClaudeToken('  sk-ant-oat01-abc ')).toBe(true)
    expect(looksLikeClaudeToken('hello')).toBe(false)
  })
})
