import type { DocumentSession } from '../core/session/session.svelte'
import { settings } from '../core/settings/settings.svelte'
import { rememberView } from './keepView'
import { confirmAndClose } from './saveFlow'

/** Decides whether a session may close (e.g. after a Save / Don't save prompt). */
export type CloseGuard = (s: DocumentSession) => Promise<boolean>

export class TabsStore {
  sessions = $state<DocumentSession[]>([])
  activeId = $state<string | null>(null)

  readonly active: DocumentSession | null = $derived(
    this.sessions.find((s) => s.id === this.activeId) ?? null,
  )

  constructor(
    private confirmClose: CloseGuard = async () => true,
    /** Runs for a tab that is closing, before its session is disposed. */
    private onClose: (s: DocumentSession) => void = () => {},
  ) {}

  findByPath(path: string): DocumentSession | undefined {
    const key = path.toLowerCase()
    return this.sessions.find((x) => x.path.toLowerCase() === key)
  }

  add(s: DocumentSession): void {
    const existing = this.findByPath(s.path)
    if (existing) {
      this.activeId = existing.id
      if (existing !== s) void s.dispose()
      return
    }
    this.sessions.push(s)
    this.activeId = s.id
  }

  /** Closes a tab once the close guard allows it; false if it stays open. */
  async close(id: string): Promise<boolean> {
    const s = this.sessions.find((x) => x.id === id)
    if (!s || !(await this.confirmClose(s))) return false
    // The tab may have moved (or gone) while the guard was prompting.
    const idx = this.sessions.indexOf(s)
    if (idx < 0) return false
    const [removed] = this.sessions.splice(idx, 1)
    if (this.activeId === id) {
      this.activeId = (this.sessions[idx] ?? this.sessions[idx - 1])?.id ?? null
    }
    this.onClose(removed)
    await removed.dispose()
    return true
  }

  next(): void {
    this.step(1)
  }

  prev(): void {
    this.step(-1)
  }

  private step(delta: number): void {
    const n = this.sessions.length
    if (n === 0) return
    const i = this.sessions.findIndex((s) => s.id === this.activeId)
    this.activeId = this.sessions[(i + delta + n) % n].id
  }
}

// Lazy: saveFlow imports this module too (import cycle).
export const tabs = new TabsStore(
  (s) => confirmAndClose(s),
  (s) => rememberView(settings, s),
)
