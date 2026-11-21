import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry, type ToolDefinition } from '../../../src/core/registry/tools'
import { eraserTool } from '../../../src/tools/eraser'
import { lassoTool } from '../../../src/tools/lasso'
import { markerTool } from '../../../src/tools/marker'
import { penTool } from '../../../src/tools/pen'
import { selectTool } from '../../../src/tools/select'
import { shapeTool } from '../../../src/tools/shape'
import { textTool } from '../../../src/tools/text'
import { strikeoutTool, underlineTool } from '../../../src/tools/textline'
import {
  SELECT_TOOL, SETTINGS_VERSION, SettingsStore, defaultToolbar, migrate, migrateToolbar, type Settings,
} from '../../../src/core/settings/settings.svelte'

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

/** The real tool definitions (as registered in src/tools/index.ts). */
const ALL_TOOLS: ToolDefinition[] = [
  selectTool, lassoTool, penTool, eraserTool, markerTool, underlineTool, strikeoutTool, textTool, shapeTool,
] as ToolDefinition[]

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SettingsStore', () => {
  it('load with null returns defaultToolbar of 7 instances in order', async () => {
    const { store } = make(null)
    await store.load()
    expect(store.data.toolbar.map((i) => i.type)).toEqual(['select', 'lasso', 'eraser', 'marker', 'pen', 'shape', 'text'])
    expect(store.data.activeInstanceId).toBe(store.data.toolbar[0].instanceId)
    expect(store.data.author).toBe('JuliePDF')
  })

  it('default toolbar: unique ids, and every instance starts with its tool\'s defaultSettings', () => {
    const tb = defaultToolbar()
    expect(new Set(tb.map((i) => i.instanceId)).size).toBe(tb.length)
    const defs = new Map(ALL_TOOLS.map((d) => [d.type, d]))
    for (const i of tb) {
      const def = defs.get(i.type)
      expect(def, i.type).toBeDefined()
      expect(i.settings, i.type).toEqual(def!.defaultSettings)
    }
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
    const bad = [
      'garbage', 42, null, [], { toolbar: [] }, { version: 3, toolbar: [] }, { version: 0, toolbar: [] },
      { version: 1.5, toolbar: [] }, { version: '2', toolbar: [] }, { version: 1, toolbar: 'x' }, { version: 2, toolbar: 'x' },
    ]
    for (const b of bad) {
      const { store } = make(b)
      await store.load()
      expect(store.data.toolbar).toHaveLength(defaultToolbar().length)
      expect(store.data.version).toBe(SETTINGS_VERSION)
      expect(store.data.preferences).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last' })
    }
  })

  it('load keeps stored data including unregistered types', async () => {
    const stored = {
      version: 2, author: 'Me', activeInstanceId: 'x',
      toolbar: [{ instanceId: 'x', type: 'future', settings: { a: 1 } }], hints: { h: true },
      preferences: { theme: 'light', toolbarPosition: 'top', reopenAt: 'start' },
      window: { maximized: true, x: -8, y: 12, width: 1400, height: 900 },
      views: [{ path: 'C:\\docs\\a.pdf', page: 3, offset: 0.25, scale: 1.5 }],
    }
    const { store } = make(stored)
    await store.load()
    expect(store.data).toEqual(stored)
  })

  it('load migrates a version 1 file: keeps its data, adds default preferences', async () => {
    const stored = {
      version: 1, author: 'Me', activeInstanceId: 'x',
      toolbar: [{ instanceId: 'x', type: 'pen', settings: { a: 1 } }], hints: { h: true },
    }
    const { store } = make(stored)
    await store.load()
    expect(store.data).toEqual({ ...stored, version: 2, preferences: { theme: 'dark', toolbarPosition: 'right', reopenAt: 'last' }, window: null, views: [] })
  })

  it('load drops a missing or malformed window state (the window then opens at its default)', async () => {
    const base = { version: 2, author: 'Me', activeInstanceId: null, toolbar: [], hints: {} }
    for (const window of [
      undefined, null, 'max', {}, { maximized: 'yes', x: 0, y: 0, width: 1, height: 1 },
      { maximized: true, x: 0, y: 0, width: 1280.5, height: 800 }, { maximized: false, x: 0, y: 0, width: 1280 },
    ]) {
      const { store } = make({ ...base, window })
      await store.load()
      expect(store.data.window).toBeNull()
    }
  })

  it('setWindowState is saved by flush (the close handler) and survives a reload', async () => {
    const { store, save } = make(null)
    await store.load()
    expect(store.data.window).toBeNull()
    const state = { maximized: true, x: 100, y: 50, width: 1200, height: 700 }
    store.setWindowState(state)
    await store.flush()
    expect(save).toHaveBeenCalledOnce()
    const saved = save.mock.calls[0][0] as Settings
    expect(saved.window).toEqual(state)
    const reloaded = make(saved).store
    await reloaded.load()
    expect(reloaded.data.window).toEqual(state)
  })

  it('rememberView is saved by flush, found case-insensitively and survives a reload', async () => {
    const { store, save } = make(null)
    await store.load()
    expect(store.data.views).toEqual([])
    store.rememberView({ path: 'C:\\Docs\\Lecture.pdf', page: 12, offset: 0.4, scale: 1.25 })
    expect(store.viewFor('c:\\docs\\lecture.PDF')).toEqual({ path: 'C:\\Docs\\Lecture.pdf', page: 12, offset: 0.4, scale: 1.25 })
    expect(store.viewFor('C:\\Docs\\Other.pdf')).toBeUndefined()
    await store.flush()
    const saved = save.mock.calls[0][0] as Settings
    const reloaded = make(saved).store
    await reloaded.load()
    expect(reloaded.viewFor('C:\\Docs\\Lecture.pdf')?.page).toBe(12)
  })

  it('load drops a missing or malformed views list', async () => {
    const base = { version: 2, author: 'Me', activeInstanceId: null, toolbar: [], hints: {} }
    for (const views of [undefined, null, 'x', {}]) {
      const { store } = make({ ...base, views })
      await store.load()
      expect(store.data.views).toEqual([])
    }
  })

  it('load replaces a missing or invalid preference by its default', async () => {
    const base = { version: 2, author: 'Me', activeInstanceId: null, toolbar: [], hints: {} }
    for (const preferences of [undefined, null, 'x', {}, { theme: 'purple' }, { theme: 1 }]) {
      const { store } = make({ ...base, preferences })
      await store.load()
      expect(store.data.preferences).toEqual({ theme: 'dark', toolbarPosition: 'right', reopenAt: 'last' })
    }
    const { store } = make({ ...base, preferences: { theme: 'system', removed: true } })
    await store.load()
    expect(store.data.preferences).toEqual({ theme: 'system', toolbarPosition: 'right', reopenAt: 'last' })
  })

  it('setPreference applies at once and saves debounced; a reload restores it', async () => {
    const { store, save } = make(null)
    await store.load()
    store.setPreference('theme', 'dark')
    store.setPreference('theme', 'light')
    expect(store.data.preferences.theme).toBe('light')
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledOnce()
    const saved = save.mock.calls[0][0] as Settings
    expect(saved.version).toBe(SETTINGS_VERSION)
    expect(saved.preferences).toEqual({ theme: 'light', toolbarPosition: 'right', reopenAt: 'last' })
    const reloaded = make(saved).store
    await reloaded.load()
    expect(reloaded.data.preferences.theme).toBe('light')
  })

  it('load falls back to defaults when ipc rejects', async () => {
    const { store, load } = make()
    load.mockRejectedValueOnce(new Error('boom'))
    await store.load()
    expect(store.data.toolbar).toHaveLength(defaultToolbar().length)
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

  it('setLocked records the lock on the instance, saves it, and load keeps it', async () => {
    const { store, save } = make()
    const a = store.addInstance('pen')
    expect(a.locked).toBeUndefined()
    store.setLocked(a.instanceId, false)
    expect(store.data.toolbar.at(-1)!.locked).toBe(false)
    await vi.runAllTimersAsync()
    const saved = save.mock.calls.at(-1)![0]
    const reloaded = make(saved).store
    await reloaded.load()
    expect(reloaded.data.toolbar.at(-1)!.locked).toBe(false)
  })

  it('duplicate keeps the lock the user set', () => {
    const { store } = make()
    const a = store.addInstance('pen')
    expect(store.duplicate(a.instanceId).locked).toBeUndefined()
    store.setLocked(a.instanceId, true)
    expect(store.duplicate(a.instanceId).locked).toBe(true)
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

  it('the last Select tool cannot be removed; removing everything else leaves it active', () => {
    const { store } = make()
    const select = store.data.toolbar.find((i) => i.type === SELECT_TOOL)!
    store.setActive(store.addInstance('pen').instanceId)
    store.data.toolbar.slice().forEach((i) => store.remove(i.instanceId))
    expect(store.data.toolbar).toEqual([select])
    expect(store.data.activeInstanceId).toBe(select.instanceId)
  })

  it('a toolbar without a Select tool (an older file) can still be emptied; nothing is active then', () => {
    const { store } = make()
    store.data.toolbar = store.data.toolbar.filter((i) => i.type !== SELECT_TOOL)
    store.setActive(store.data.toolbar[0].instanceId)
    store.data.toolbar.slice().forEach((i) => store.remove(i.instanceId))
    expect(store.data.toolbar).toEqual([])
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

  it('migrate does not change the object it was given', () => {
    const v1 = { version: 1, toolbar: [] }
    expect(migrate(v1)).toEqual({ version: 2, toolbar: [], preferences: { theme: 'dark', toolbarPosition: 'right', reopenAt: 'last' } })
    expect(v1).toEqual({ version: 1, toolbar: [] })
  })

  it('load applies it to the stored toolbar', async () => {
    const stored = { version: 1, author: 'Me', activeInstanceId: 'h', toolbar: [i('s', 'select'), i('h', 'hand')], hints: {} }
    const { store } = make(stored)
    await store.load()
    expect(store.data.toolbar.map((t) => t.type)).toEqual(['select'])
    expect(store.data.activeInstanceId).toBe('s')
  })
})
