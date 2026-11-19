import { loadSettings, saveSettings } from '../ipc/api'
import { toolRegistry, type ToolRegistry } from '../registry/tools'

export interface ToolInstance { instanceId: string; type: string; settings: unknown }
export interface Settings {
  version: 1
  author: string
  toolbar: ToolInstance[]
  activeInstanceId: string | null
  hints: Record<string, boolean>
}

export interface SettingsIpc {
  load(): Promise<unknown | null>
  save(value: unknown): Promise<void>
}

const SAVE_DELAY_MS = 500

function inst(type: string, settings: unknown): ToolInstance {
  return { instanceId: crypto.randomUUID(), type, settings }
}

export function defaultToolbar(): ToolInstance[] {
  return [
    inst('select', {}),
    inst('lasso', {}),
    inst('marker', { mode: 'text', color: [1, 0.922, 0.231], opacity: 0.4, width: 14 }),
    inst('pen', { color: [0.898, 0.224, 0.208], width: 2, opacity: 1 }),
    inst('text', { textColor: [0.1, 0.1, 0.1], fontSize: 12, background: null }),
    inst('eraser', {}),
  ]
}

function defaultSettings(): Settings {
  const toolbar = defaultToolbar()
  return { version: 1, author: 'JuliePDF', toolbar, activeInstanceId: toolbar[0].instanceId, hints: {} }
}

function isValid(v: unknown): v is Settings {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.version === 1 && Array.isArray(o.toolbar) && o.toolbar.every(
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
    if (isValid(stored)) {
      const o = stored as Partial<Settings> & Settings
      const { toolbar, activeId } = migrateToolbar(o.toolbar, o.activeInstanceId)
      const active = toolbar.some((i) => i.instanceId === activeId)
        ? activeId
        : (toolbar[0]?.instanceId ?? null)
      this.data = {
        version: 1,
        author: typeof o.author === 'string' ? o.author : 'JuliePDF',
        toolbar,
        activeInstanceId: active,
        hints: typeof o.hints === 'object' && o.hints !== null ? o.hints : {},
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
    this.data.toolbar.splice(idx + 1, 0, inst(src.type, clone($state.snapshot(src.settings))))
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
