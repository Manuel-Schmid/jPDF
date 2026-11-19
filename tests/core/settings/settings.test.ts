import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry, type ToolDefinition } from '../../../src/core/registry/tools'
import { SettingsStore, defaultToolbar, migrateToolbar } from '../../../src/core/settings/settings.svelte'

function def(type: string, allowMultipleInstances = true): ToolDefinition {
  return {
    type, displayName: type, description: '', Icon: null as never,
    defaultSettings: { color: [1, 0, 0], width: 3 }, Options: null,
    allowMultipleInstances, createHandler: () => ({}),
  }
}

function make(stored: unknown = null) {
  const load = vi.fn(async () => stored)
  const save = vi.fn(async (_v: unknown) => {})
  const registry = createToolRegistry()
  registry.register(def('pen'))
  registry.register(def('select', false))
  const store = new SettingsStore({ load, save }, registry)
  return { store, load, save }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SettingsStore', () => {
  it('load with null returns defaultToolbar of 6 instances in order', async () => {
    const { store } = make(null)
    await store.load()
    expect(store.data.toolbar.map((i) => i.type)).toEqual(['select', 'lasso', 'marker', 'pen', 'text', 'eraser'])
    expect(store.data.activeInstanceId).toBe(store.data.toolbar[0].instanceId)
    expect(store.data.author).toBe('JuliePDF')
  })

  it('default toolbar settings and unique ids', () => {
    const tb = defaultToolbar()
    expect(tb[2].settings).toEqual({ mode: 'text', color: [1, 0.922, 0.231], opacity: 0.4, width: 14 })
    expect(tb[5].settings).toEqual({})
    expect(new Set(tb.map((i) => i.instanceId)).size).toBe(6)
  })

  it('setHint records the flag and saves it', async () => {
    const { store, save } = make(null)
    await store.load()
    store.setHint('markerFallback')
    expect(store.data.hints.markerFallback).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    expect((save.mock.calls[0][0] as { hints: Record<string, boolean> }).hints).toEqual({ markerFallback: true })
  })

  it('load with corrupt/unknown version falls back to defaults', async () => {
    for (const bad of ['garbage', { version: 2, toolbar: [] }, { version: 1, toolbar: 'x' }, 42]) {
      const { store } = make(bad)
      await store.load()
      expect(store.data.toolbar).toHaveLength(6)
    }
  })

  it('load keeps stored data including unregistered types', async () => {
    const stored = {
      version: 1, author: 'Me', activeInstanceId: 'x',
      toolbar: [{ instanceId: 'x', type: 'future', settings: { a: 1 } }], hints: { h: true },
    }
    const { store } = make(stored)
    await store.load()
    expect(store.data).toEqual(stored)
  })

  it('load falls back to defaults when ipc rejects', async () => {
    const { store, load } = make()
    load.mockRejectedValueOnce(new Error('boom'))
    await store.load()
    expect(store.data.toolbar).toHaveLength(6)
  })

  it('addInstance appends with defaultSettings', () => {
    const { store } = make()
    const inst = store.addInstance('pen')
    expect(store.data.toolbar.at(-1)).toBe(inst)
    expect(inst.settings).toEqual({ color: [1, 0, 0], width: 3 })
    expect(inst.settings).not.toBe(store.data.toolbar[0].settings)
  })

  it('addInstance of unregistered type throws', () => {
    expect(() => make().store.addInstance('nope')).toThrow()
  })

  it('duplicate copies settings with new instanceId', () => {
    const { store } = make()
    const a = store.addInstance('pen')
    store.updateSettings(a.instanceId, { width: 9 })
    const b = store.duplicate(a.instanceId)
    expect(b.instanceId).not.toBe(a.instanceId)
    expect(b.settings).toEqual({ color: [1, 0, 0], width: 9 })
    expect(b.settings).not.toBe(a.settings)
    expect(store.data.toolbar.indexOf(b)).toBe(store.data.toolbar.indexOf(a) + 1)
  })

  it('addInstance of tool with allowMultipleInstances=false when one exists returns existing', () => {
    const { store } = make()
    const existing = store.data.toolbar.find((i) => i.type === 'select')!
    expect(store.addInstance('select')).toBe(existing)
    expect(store.data.toolbar.filter((i) => i.type === 'select')).toHaveLength(1)
  })

  it('remove active instance activates first instance', () => {
    const { store } = make()
    const pen = store.addInstance('pen')
    store.setActive(pen.instanceId)
    store.remove(pen.instanceId)
    expect(store.data.activeInstanceId).toBe(store.data.toolbar[0].instanceId)
  })

  it('remove last instance leaves null active', () => {
    const { store } = make()
    store.data.toolbar.slice().forEach((i) => store.remove(i.instanceId))
    expect(store.data.activeInstanceId).toBeNull()
  })

  it('move reorders', () => {
    const { store } = make()
    const first = store.data.toolbar[0]
    store.move(first.instanceId, 3)
    expect(store.data.toolbar[3].instanceId).toBe(first.instanceId)
  })

  it('updateSettings merges patch', () => {
    const { store } = make()
    const m = store.data.toolbar.find((i) => i.type === 'marker')!
    store.updateSettings(m.instanceId, { opacity: 0.7 })
    expect(m.settings).toMatchObject({ mode: 'text', opacity: 0.7 })
  })

  it('mutations trigger exactly one save after 500 ms', async () => {
    const { store, save } = make()
    const inst = store.addInstance('pen')
    store.updateSettings(inst.instanceId, { width: 5 })
    store.setActive(inst.instanceId)
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toEqual(JSON.parse(JSON.stringify(store.data)))
  })

  it('flush saves immediately once and cancels the timer', async () => {
    const { store, save } = make()
    await store.flush()
    expect(save).not.toHaveBeenCalled()
    store.addInstance('pen')
    await store.flush()
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush waits for a save already in flight', async () => {
    const { store, save } = make()
    let release!: () => void
    save.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    store.addInstance('pen')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    let flushed = false
    const p = store.flush().then(() => (flushed = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(flushed).toBe(false)
    release()
    await p
    expect(flushed).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush during an in-flight save saves the newer state after it', async () => {
    const { store, save } = make()
    let release!: () => void
    save.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const inst = store.addInstance('pen')
    await vi.advanceTimersByTimeAsync(500)
    store.updateSettings(inst.instanceId, { width: 9 })
    const p = store.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await p
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toEqual(JSON.parse(JSON.stringify(store.data)))
  })
})

describe('migrateToolbar (retired tools)', () => {
  const i = (instanceId: string, type: string) => ({ instanceId, type, settings: {} })

  it('drops the hand when the toolbar has a select tool, handing an active hand over to it', () => {
    const r = migrateToolbar([i('s', 'select'), i('h', 'hand'), i('p', 'pen')], 'h')
    expect(r.toolbar.map((t) => t.instanceId)).toEqual(['s', 'p'])
    expect(r.activeId).toBe('s')
    expect(migrateToolbar([i('h', 'hand'), i('s', 'select')], 'h').activeId).toBe('s')
  })

  it('turns the hand into the select tool in place when there is none', () => {
    const r = migrateToolbar([i('p', 'pen'), i('h', 'hand')], 'h')
    expect(r.toolbar).toEqual([i('p', 'pen'), i('h', 'select')])
    expect(r.activeId).toBe('h')
  })

  it('load applies it to the stored toolbar', async () => {
    const stored = { version: 1, author: 'Me', activeInstanceId: 'h', toolbar: [i('s', 'select'), i('h', 'hand')], hints: {} }
    const { store } = make(stored)
    await store.load()
    expect(store.data.toolbar.map((t) => t.type)).toEqual(['select'])
    expect(store.data.activeInstanceId).toBe('s')
  })
})
