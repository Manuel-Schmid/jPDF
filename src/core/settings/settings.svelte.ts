import { loadSettings, saveSettings } from '../ipc/api'
import { toolRegistry, type ToolRegistry } from '../registry/tools'
import { defaultPreferences, readPreferences, type Preferences } from './preferences'
import { TOOL_PRESETS, presetSettings, type ToolPreset } from './toolPresets'
import { findView, readViews, withView, type RememberedView } from './viewMemory'

export interface ToolInstance {
  instanceId: string
  type: string
  settings: unknown
  /** Set once the user toggles the lock; absent: the tool's defaultLocked. */
  locked?: boolean
}

/**
 * The shape of settings.json, by version:
 * 1: toolbar, author and hints.
 * 2: adds `preferences` (the settings dialog).
 *
 * Bump it (and add a step to `migrate`) only when the shape changes in a way
 * defaults cannot cover; a new preference is just an entry in `PREFERENCES`
 * (preferences.ts).
 */
export const SETTINGS_VERSION = 2

export interface Settings {
  version: typeof SETTINGS_VERSION
  author: string
  toolbar: ToolInstance[]
  activeInstanceId: string | null
  hints: Record<string, boolean>
  preferences: Preferences
  /**
   * How the window was last left (saved on close, applied by the backend at
   * startup before the window is shown); null until the first close.
   */
  window: WindowState | null
  /**
   * Where recently closed files were left (page and zoom), most recent
   * first and bounded (viewMemory.ts); recorded on close only.
   */
  views: RememberedView[]
}

/**
 * The window's normal (un-maximized) rectangle and whether it was maximized,
 * as the backend's `window_state` reports it (physical pixels, Windows
 * workspace coordinates). The frontend only stores it.
 */
export interface WindowState {
  maximized: boolean
  x: number
  y: number
  width: number
  height: number
}

/** A stored `window` value, or null when absent or malformed. */
export function readWindowState(v: unknown): WindowState | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.maximized !== 'boolean') return null
  const nums = [o.x, o.y, o.width, o.height]
  if (!nums.every((n) => Number.isInteger(n))) return null
  return { maximized: o.maximized, x: o.x as number, y: o.y as number, width: o.width as number, height: o.height as number }
}

export interface SettingsIpc {
  load(): Promise<unknown | null>
  save(value: unknown): Promise<void>
}

const SAVE_DELAY_MS = 500

/**
 * The select tool: Escape and unlocked tools hand over to it, so the toolbar
 * must keep it (`SettingsStore.remove` refuses to remove the last one).
 */
export const SELECT_TOOL = 'select'

function inst(type: string, settings: unknown): ToolInstance {
  return { instanceId: crypto.randomUUID(), type, settings }
}

/** A preset's tools as toolbar instances with fresh ids and their own copies of the settings. */
export function toolbarFromPreset(preset: ToolPreset): ToolInstance[] {
  return preset.toolbar.map((t) => {
    const i = inst(t.type, presetSettings(t))
    if (t.locked !== undefined) i.locked = t.locked
    return i
  })
}

/**
 * The toolbar of a fresh install: the Default preset. Each instance starts
 * with its tool's `defaultSettings` (a test keeps the two in sync; the tools
 * are not imported here, the registry is filled at startup).
 */
export function defaultToolbar(): ToolInstance[] {
  return toolbarFromPreset(TOOL_PRESETS[0])
}

/** The toolbar and its active tool, as `applyPreset` returns them for an undo. */
export interface ToolbarSnapshot {
  toolbar: ToolInstance[]
  activeInstanceId: string | null
}

function defaultSettings(): Settings {
  const toolbar = defaultToolbar()
  return {
    version: SETTINGS_VERSION,
    author: 'JuliePDF',
    toolbar,
    activeInstanceId: toolbar[0].instanceId,
    hints: {},
    preferences: defaultPreferences(),
    window: null,
    views: [],
  }
}

/**
 * A stored file brought up to `SETTINGS_VERSION`, one version at a time.
 * Null for anything without a known version, including a newer one written
 * by a later JuliePDF (its shape is unknown).
 */
export function migrate(stored: unknown): Record<string, unknown> | null {
  if (typeof stored !== 'object' || stored === null) return null
  const o = { ...(stored as Record<string, unknown>) }
  const v = o.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > SETTINGS_VERSION) return null
  if (o.version === 1) {
    o.preferences = defaultPreferences()
    o.version = 2
  }
  return o
}

function isValid(v: unknown): v is Settings {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.version === SETTINGS_VERSION && Array.isArray(o.toolbar) && o.toolbar.every(
    (i) => typeof i === 'object' && i !== null
      && typeof (i as ToolInstance).instanceId === 'string' && typeof (i as ToolInstance).type === 'string',
  )
}

/** Tools that were merged into another one: their saved instances become that tool. */
const RETIRED_TOOLS: Record<string, string> = {
  // The select tool pans by dragging blank space.
  hand: 'select',
}

/**
 * The saved toolbar without retired tools: each instance becomes its
 * successor, in place and keeping its id (so an active one stays active),
 * unless the toolbar already has one of that tool; then it is dropped and
 * an active one hands over to the existing one.
 */
export function migrateToolbar(toolbar: ToolInstance[], activeId: string | null): { toolbar: ToolInstance[]; activeId: string | null } {
  const out: ToolInstance[] = []
  let active = activeId
  for (const i of toolbar) {
    const successor = RETIRED_TOOLS[i.type]
    if (!successor) {
      out.push(i)
      continue
    }
    const existing = out.find((o) => o.type === successor) ?? toolbar.find((o) => o.type === successor)
    if (!existing) out.push({ instanceId: i.instanceId, type: successor, settings: {} })
    else if (active === i.instanceId) active = existing.instanceId
  }
  return { toolbar: out, activeId: active }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export class SettingsStore {
  data: Settings = $state(defaultSettings())
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Tail of the save chain: saves run one at a time, in order. */
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private ipc: SettingsIpc = { load: loadSettings, save: saveSettings },
    private registry: ToolRegistry = toolRegistry,
  ) {}

  async load(): Promise<void> {
    let stored: unknown = null
    try {
      stored = await this.ipc.load()
    } catch (e) {
      console.error('Failed to load settings', e)
    }
    const current = migrate(stored)
    if (isValid(current)) {
      const o = current as Partial<Settings> & Settings
      const { toolbar, activeId } = migrateToolbar(o.toolbar, o.activeInstanceId)
      const active = toolbar.some((i) => i.instanceId === activeId)
        ? activeId
        : (toolbar[0]?.instanceId ?? null)
      this.data = {
        version: SETTINGS_VERSION,
        author: typeof o.author === 'string' ? o.author : 'JuliePDF',
        toolbar,
        activeInstanceId: active,
        hints: typeof o.hints === 'object' && o.hints !== null ? o.hints : {},
        preferences: readPreferences(o.preferences),
        window: readWindowState(o.window),
        views: readViews(o.views),
      }
    } else {
      this.data = defaultSettings()
    }
  }

  addInstance(type: string): ToolInstance {
    const def = this.registry.get(type)
    if (!def.allowMultipleInstances) {
      const existing = this.data.toolbar.find((i) => i.type === type)
      if (existing) return existing
    }
    this.data.toolbar.push(inst(type, clone(def.defaultSettings)))
    this.scheduleSave()
    return this.data.toolbar[this.data.toolbar.length - 1]
  }

  duplicate(instanceId: string): ToolInstance {
    const idx = this.indexOf(instanceId)
    const src = this.data.toolbar[idx]
    const def = this.registry.get(src.type)
    if (!def.allowMultipleInstances) return src
    const copy = inst(src.type, clone($state.snapshot(src.settings)))
    if (src.locked !== undefined) copy.locked = src.locked
    this.data.toolbar.splice(idx + 1, 0, copy)
    this.scheduleSave()
    return this.data.toolbar[idx + 1]
  }

  /** Removes the instance, unless it is the toolbar's last Select tool (then nothing happens). */
  remove(instanceId: string): void {
    const idx = this.indexOf(instanceId)
    if (this.data.toolbar[idx].type === SELECT_TOOL && this.data.toolbar.filter((i) => i.type === SELECT_TOOL).length === 1) {
      return
    }
    this.data.toolbar.splice(idx, 1)
    if (this.data.activeInstanceId === instanceId) {
      this.data.activeInstanceId = this.data.toolbar[0]?.instanceId ?? null
    }
    this.scheduleSave()
  }

  move(instanceId: string, toIndex: number): void {
    const idx = this.indexOf(instanceId)
    const [item] = this.data.toolbar.splice(idx, 1)
    const to = Math.max(0, Math.min(toIndex, this.data.toolbar.length))
    this.data.toolbar.splice(to, 0, item)
    this.scheduleSave()
  }

  updateSettings(instanceId: string, patch: object): void {
    const i = this.data.toolbar[this.indexOf(instanceId)]
    i.settings = { ...(i.settings as object), ...patch }
    this.scheduleSave()
  }

  /** Locks (stays active after use) or unlocks (hands over to the select tool) an instance. */
  setLocked(instanceId: string, locked: boolean): void {
    this.data.toolbar[this.indexOf(instanceId)].locked = locked
    this.scheduleSave()
  }

  setActive(instanceId: string): void {
    this.indexOf(instanceId)
    this.data.activeInstanceId = instanceId
    this.scheduleSave()
  }

  /**
   * Replaces the whole toolbar with a preset; its Select tool becomes the
   * active one. Returns the toolbar it replaced, for `restoreToolbar` (undo).
   */
  applyPreset(preset: ToolPreset): ToolbarSnapshot {
    const previous = this.toolbarSnapshot()
    const toolbar = toolbarFromPreset(preset)
    this.data.toolbar = toolbar
    this.data.activeInstanceId = (toolbar.find((i) => i.type === SELECT_TOOL) ?? toolbar[0])?.instanceId ?? null
    this.scheduleSave()
    return previous
  }

  /** Puts back a toolbar that `applyPreset` replaced. */
  restoreToolbar(snapshot: ToolbarSnapshot): void {
    this.data.toolbar = clone(snapshot.toolbar)
    this.data.activeInstanceId = snapshot.activeInstanceId
    this.scheduleSave()
  }

  private toolbarSnapshot(): ToolbarSnapshot {
    return { toolbar: clone($state.snapshot(this.data.toolbar)), activeInstanceId: this.data.activeInstanceId }
  }

  /** Records a one-time hint flag (e.g. a tip was shown) and persists it. */
  setHint(key: string, value = true): void {
    this.data.hints[key] = value
    this.scheduleSave()
  }

  /** Changes one preference (settings dialog) and persists it. */
  setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    this.data.preferences[key] = value
    this.scheduleSave()
  }

  /** Records how the window was left (on close; `flush` writes it). */
  setWindowState(state: WindowState): void {
    this.data.window = state
    this.scheduleSave()
  }

  /** Records where the file at `view.path` was left (on close). */
  rememberView(view: RememberedView): void {
    this.data.views = withView(this.data.views, view)
    this.scheduleSave()
  }

  /** Where the file at `path` was left when it was last closed, if remembered. */
  viewFor(path: string): RememberedView | undefined {
    return findView(this.data.views, path)
  }

  /** Saves immediately if a save is pending; resolves once no save is in flight. */
  async flush(): Promise<void> {
    if (this.timer === null) return this.saving
    clearTimeout(this.timer)
    this.timer = null
    await this.save()
  }

  private indexOf(instanceId: string): number {
    const idx = this.data.toolbar.findIndex((i) => i.instanceId === instanceId)
    if (idx < 0) throw new Error(`Unknown tool instance: ${instanceId}`)
    return idx
  }

  private scheduleSave(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, SAVE_DELAY_MS)
  }

  private save(): Promise<void> {
    this.saving = this.saving.then(async () => {
      try {
        await this.ipc.save($state.snapshot(this.data))
      } catch (e) {
        console.error('Failed to save settings', e)
      }
    })
    return this.saving
  }
}

export const settings = new SettingsStore()
