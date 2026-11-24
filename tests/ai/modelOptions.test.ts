import { describe, expect, it } from 'vitest'
import type { CliModel } from '../../src/ai/cliIpc'
import { FALLBACK, effortsFor, groupModels, withStored } from '../../src/ai/modelOptions'

const m = (value: string, efforts: string[] = ['low', 'high'], isDefault = false): CliModel => ({
  value, label: value.toUpperCase(), description: '', efforts, isDefault,
})

const claude = [
  m('default'), m('opus'), m('fable'), m('sonnet'), m('haiku', []), m('sonnet[1m]'),
  m('claude-opus-5'), m('claude-sonnet-4-6'), m('claude-haiku-4-5-20251001', []),
]

describe('groupModels', () => {
  it('Claude: aliases (no digit) are main, pinned versions are more, in CLI order', () => {
    const g = groupModels(claude, 'claude')
    expect(g.main.map((x) => x.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku', 'sonnet[1m]'])
    expect(g.more.map((x) => x.value)).toEqual(['claude-opus-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'])
  })

  it('Codex: every model is main, after a "CLI default" with the default model\'s efforts', () => {
    const codex = [m('gpt-6.2-astra', ['low']), m('gpt-6.2-sol', ['low', 'medium', 'max'], true), m('gpt-6.1-terra')]
    const g = groupModels(codex, 'codex')
    expect(g.more).toEqual([])
    expect(g.main.map((x) => x.value)).toEqual(['', 'gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra'])
    expect(g.main[0]).toMatchObject({ label: 'CLI default', efforts: ['low', 'medium', 'max'] })
  })
})

describe('withStored', () => {
  it('keeps a stored value the list no longer has, under "more"', () => {
    const g = withStored(groupModels(claude, 'claude'), 'claude-opus-4-1')
    expect(g.more.at(-1)).toMatchObject({ value: 'claude-opus-4-1', label: 'claude-opus-4-1', efforts: [] })
  })
  it('adds nothing for an empty, main or pinned value', () => {
    const g = groupModels(claude, 'claude')
    expect(withStored(g, '')).toEqual(g)
    expect(withStored(g, 'opus')).toEqual(g)
    expect(withStored(g, 'claude-opus-5')).toEqual(g)
  })
})

describe('effortsFor', () => {
  it('lists the model\'s efforts; haiku and unknown models have none', () => {
    expect(effortsFor(claude, 'opus')).toEqual(['low', 'high'])
    expect(effortsFor(claude, 'haiku')).toEqual([])
    expect(effortsFor(claude, 'nope')).toEqual([])
  })
})

describe('FALLBACK', () => {
  it('offers common Claude aliases and the Codex CLI default', () => {
    expect(FALLBACK.claude.map((x) => x.value)).toEqual(['default', 'opus', 'sonnet', 'haiku'])
    expect(effortsFor(FALLBACK.claude, 'haiku')).toEqual([])
    expect(FALLBACK.codex).toHaveLength(1)
    expect(FALLBACK.codex[0]).toMatchObject({ value: '', label: 'CLI default', efforts: ['low', 'medium', 'high', 'xhigh'] })
  })
})
