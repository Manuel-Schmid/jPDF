import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry, type ToolDefinition } from '../../../src/core/registry/tools'
import { SettingsStore, defaultToolbar } from '../../../src/core/settings/settings.svelte'
import { TOOL_PRESETS, matchesPreset } from '../../../src/core/settings/toolPresets'
import { eraserTool } from '../../../src/tools/eraser'
import { lassoTool } from '../../../src/tools/lasso'
import { markerTool } from '../../../src/tools/marker'
import { penTool } from '../../../src/tools/pen'
import { selectTool } from '../../../src/tools/select'
import { shapeTool } from '../../../src/tools/shape'
import { textTool } from '../../../src/tools/text'
import { strikeoutTool, underlineTool } from '../../../src/tools/textline'

const ALL_TOOLS = [
  selectTool, lassoTool, penTool, eraserTool, markerTool, underlineTool, strikeoutTool, textTool, shapeTool,
] as ToolDefinition[]
const DEFS = new Map(ALL_TOOLS.map((d) => [d.type, d]))

function make(stored: unknown = null) {
  const save = vi.fn(async (_v: unknown) => {})
  const store = new SettingsStore({ load: async () => stored, save }, createToolRegistry())
  return { store, save }
}

const preset = (id: string) => TOOL_PRESETS.find((p) => p.id === id)!

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TOOL_PRESETS', () => {
  it('offers Default and four recommended presets with unique ids', () => {
    expect(TOOL_PRESETS.map((p) => p.name)).toEqual([
      'Default', 'Taking lecture notes', 'Proofreading', 'Sketching and diagrams', 'Minimal',
    ])
    expect(new Set(TOOL_PRESETS.map((p) => p.id)).size).toBe(TOOL_PRESETS.length)
  })

  it.each(TOOL_PRESETS.map((p) => [p.name, p] as const))('%s: fits the registered tools', (_name, p) => {
    expect(p.toolbar.filter((t) => t.type === 'select')).toHaveLength(1)
    for (const t of p.toolbar) {
      const def = DEFS.get(t.type)
      expect(def, t.type).toBeDefined()
      // The same settings keys as the tool's defaults, so the Options panel finds every field.
      expect(Object.keys(t.settings as object).sort(), t.type).toEqual(Object.keys(def!.defaultSettings as object).sort())
      if (def!.allowMultipleInstances === false) expect(p.toolbar.filter((o) => o.type === t.type), t.type).toHaveLength(1)
    }
  })

  it('Default is the fresh-install toolbar', () => {
    expect(matchesPreset(defaultToolbar(), preset('default'))).toBe(true)
  })

  it('Taking lecture notes has the requested tools in order', () => {
    const tb = preset('lecture-notes').toolbar
    const BLUE = [0.118, 0.533, 0.898]
    expect(tb.map((t) => t.type)).toEqual([
      'select', 'text', 'text', 'pen', 'pen', 'marker', 'marker', 'marker', 'marker', 'marker', 'shape', 'shape',
    ])
    // Blue small text on a transparent background, then black small text on white.
    expect(tb[1].settings).toMatchObject({ textColor: BLUE, fontSize: 10, background: null })
    expect(tb[2].settings).toMatchObject({ textColor: [0, 0, 0], fontSize: 10, background: { color: [1, 1, 1], opacity: 1 } })
    expect(tb[3].settings).toMatchObject({ color: [0, 0, 0] })
    expect(tb[4].settings).toMatchObject({ color: [0.898, 0.224, 0.208] })
    // Text-select highlighters: cyan, blue, green, pink, yellow.
    expect(tb.slice(5, 10).map((t) => (t.settings as { mode: string }).mode)).toEqual(Array(5).fill('text'))
    expect(tb.slice(5, 10).map((t) => (t.settings as { color: number[] }).color)).toEqual([
      [0.094, 1, 1], [0.251, 0.769, 1], [0.463, 1, 0.012], [1, 0.251, 0.506], [1, 0.922, 0.231],
    ])
    // A red outlined rectangle and an opaque white one without border (white-out).
    expect(tb[10].settings).toEqual({ shape: 'rect', border: { color: [0.898, 0.224, 0.208], width: 2, opacity: 1 }, fill: null })
    expect(tb[11].settings).toEqual({ shape: 'rect', border: null, fill: { color: [1, 1, 1], opacity: 1 } })
  })
})

describe('matchesPreset', () => {
  it('ignores ids and key order, but not a changed setting, lock or order', () => {
    const p = preset('minimal')
    const tb = p.toolbar.map((t, i) => ({ instanceId: String(i), ...t, settings: { ...(t.settings as object) } }))
    expect(matchesPreset(tb, p)).toBe(true)
    expect(matchesPreset([...tb].reverse(), p)).toBe(false)
    expect(matchesPreset(tb.map((t, i) => (i === 2 ? { ...t, settings: { ...t.settings, width: 9 } } : t)), p)).toBe(false)
    expect(matchesPreset(tb.map((t, i) => (i === 2 ? { ...t, locked: false } : t)), p)).toBe(false)
    expect(matchesPreset(tb.slice(1), p)).toBe(false)
  })
})

describe('SettingsStore.applyPreset', () => {
  it('replaces the toolbar with fresh instances, activates Select and saves', async () => {
    const { store, save } = make()
    await store.load()
    const before = store.data.toolbar.map((i) => i.instanceId)
    store.applyPreset(preset('lecture-notes'))
    expect(matchesPreset(store.data.toolbar, preset('lecture-notes'))).toBe(true)
    expect(store.data.toolbar.some((i) => before.includes(i.instanceId))).toBe(false)
    expect(new Set(store.data.toolbar.map((i) => i.instanceId)).size).toBe(store.data.toolbar.length)
    const active = store.data.toolbar.find((i) => i.instanceId === store.data.activeInstanceId)
    expect(active?.type).toBe('select')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    expect((save.mock.calls[0][0] as { toolbar: unknown[] }).toolbar).toHaveLength(12)
  })

  it('changing a tool afterwards leaves the preset untouched', async () => {
    const { store } = make()
    await store.load()
    store.applyPreset(preset('minimal'))
    const pen = store.data.toolbar.find((i) => i.type === 'pen')!
    store.updateSettings(pen.instanceId, { width: 8 })
    ;(store.data.toolbar[1].settings as { color: number[] }).color[0] = 0.5
    expect(preset('minimal').toolbar[2].settings).toMatchObject({ width: 1.5 })
    expect(preset('minimal').toolbar[1].settings).toMatchObject({ color: [1, 0.922, 0.231] })
    expect(matchesPreset(store.data.toolbar, preset('minimal'))).toBe(false)
  })

  it('restoreToolbar puts back the replaced toolbar and active tool', async () => {
    const { store } = make()
    await store.load()
    const pen = store.data.toolbar.find((i) => i.type === 'pen')!
    store.updateSettings(pen.instanceId, { width: 7 })
    store.setActive(pen.instanceId)
    const before = JSON.parse(JSON.stringify(store.data.toolbar))
    const previous = store.applyPreset(preset('proofreading'))
    store.restoreToolbar(previous)
    expect(JSON.parse(JSON.stringify(store.data.toolbar))).toEqual(before)
    expect(store.data.activeInstanceId).toBe(pen.instanceId)
  })

  it('an applied preset survives a restart (save, then load)', async () => {
    const { store, save } = make()
    await store.load()
    store.applyPreset(preset('lecture-notes'))
    await store.flush()
    const { store: reopened } = make(save.mock.calls.at(-1)![0])
    await reopened.load()
    expect(reopened.data.toolbar).toEqual(JSON.parse(JSON.stringify(store.data.toolbar)))
    expect(reopened.data.activeInstanceId).toBe(store.data.activeInstanceId)
  })
})
