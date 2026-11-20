import { loadSettings, saveSettings } from '../ipc/api'
import { toolRegistry, type ToolRegistry } from '../registry/tools'
import { defaultPreferences, readPreferences, type Preferences } from './preferences'

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
}

export interface SettingsIpc {
  load(): Promise<unknown | null>
  save(value: unknown): Promise<void>
}

const SAVE_DELAY_MS = 500

function inst(type: string, settings: unknown): ToolInstance {
  return { instanceId: crypto.randomUUID(), type, settings }
}

/**
 * The toolbar of a fresh install. Each instance starts with its tool's
 * `defaultSettings` (a test keeps the two in sync; the tools are not imported
 * here, the registry is filled at startup).
 */
export function defaultToolbar(): ToolInstance[] {
  return [
    inst('select', {}),
    inst('lasso', {}),
    inst('eraser', {}),
    inst('marker', { mode: 'text', color: [1, 0.922, 0.231], opacity: 1, width: 12 }),
    inst('pen', { color: [0.898, 0.224, 0.208], width: 1.5, opacity: 1 }),
    inst('shape', { shape: 'rect', border: { color: [0.898, 0.224, 0.208], width: 2, opacity: 1 }, fill: null }),
    inst('text', { textColor: [0, 0, 0], fontSize: 12, background: null, align: 'left' }),
  ]
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

  remove(instanceId: string): void {
    const idx = this.indexOf(instanceId)
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
