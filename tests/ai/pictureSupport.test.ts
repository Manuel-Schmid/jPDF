import { afterEach, describe, expect, it } from 'vitest'
import type { CliModel } from '../../src/ai/cliIpc'
import { forgetModels, knownDefaultModel, rememberModels } from '../../src/ai/pictureSupport.svelte'

const model = (value: string, isDefault: boolean): CliModel => ({
  value,
  label: value,
  description: '',
  efforts: [],
  isDefault,
  images: true,
})

afterEach(() => forgetModels())

describe('knownDefaultModel', () => {
  it('is the model the CLI marks as its default', () => {
    rememberModels('codex', 'C:\codex.exe', [model('gpt-astra', false), model('gpt-sol', true)])
    expect(knownDefaultModel('codex', 'C:\codex.exe')).toBe('gpt-sol')
  })

  it('is undefined without a list, or when no model is marked', () => {
    expect(knownDefaultModel('codex', 'C:\codex.exe')).toBeUndefined()
    rememberModels('codex', 'C:\codex.exe', [model('gpt-astra', false)])
    expect(knownDefaultModel('codex', 'C:\codex.exe')).toBeUndefined()
  })
})
