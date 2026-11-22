import type { ToastAction, ToastKind } from '../ui/toasts.svelte'

/** A newer release than the running one. */
export interface AvailableUpdate {
  version: string
  /** The release notes, if any. */
  notes?: string
  /** Downloads the installer and checks its signature; `progress` gets 0..1, or null while the size is unknown. */
  download(progress: (fraction: number | null) => void): Promise<void>
  /** Runs the downloaded installer; on Windows the app exits as it starts. */
  install(): Promise<void>
}

export type UpdateChoice = 'update' | 'later'

export interface UpdaterDeps {
  /** The newer release, or null when this is the latest version; rejects when it can't be checked (offline …). */
  check(): Promise<AvailableUpdate | null>
  /** Offers the update to the user. */
  ask(version: string, notes: string | undefined): Promise<UpdateChoice>
  /** Shows the download progress (a fraction, or null when unknown); undefined hides it. */
  progress(fraction: number | null | undefined): void
  /**
   * Gets ready for the app to exit, like closing the window: Save / Don't
   * save / Cancel for each dirty tab, then the window state and settings are
   * saved. False when the user cancelled.
   */
  quit(): Promise<boolean>
  notify(message: string, kind: ToastKind, action?: ToastAction): void
}

/** How long after startup the automatic check runs, so it never competes with opening a PDF. */
export const STARTUP_DELAY_MS = 5000

/**
 * Looks for a new version and installs it when the user agrees.
 *
 * The automatic check runs once per start, a few seconds in, and stays
 * silent unless there is an update; "Check now" in the settings also says
 * when JuliePDF is up to date or the check failed. The installer is
 * downloaded first (the user can keep working), then the open tabs are
 * closed like on exit, then it runs.
 */
export class Updater {
  /** A check is running ("Check now" shows "Checking…"). */
  checking = $state(false)
  /** An update was offered and not yet declined, downloaded or installed: no second check meanwhile. */
  private busy = false

  constructor(private readonly deps: UpdaterDeps) {}

  /** Runs the automatic check `delayMs` after now, if `enabled()` then. Returns a canceller. */
  scheduleStartupCheck(enabled: () => boolean, delayMs = STARTUP_DELAY_MS): () => void {
    const timer = setTimeout(() => {
      if (enabled()) void this.run(false)
    }, delayMs)
    return () => clearTimeout(timer)
  }

  /** "Check now": like the automatic check, but also reports "up to date" and failures. */
  checkNow(): Promise<void> {
    return this.run(true)
  }

  private async run(manual: boolean): Promise<void> {
    if (this.checking || this.busy) return
    this.checking = true
    let update: AvailableUpdate | null
    try {
      update = await this.deps.check()
    } catch (e) {
      console.warn('Could not check for updates', e)
      if (manual) this.deps.notify('Could not check for updates. Are you online?', 'error')
      return
    } finally {
      this.checking = false
    }
    if (!update) {
      if (manual) this.deps.notify('JuliePDF is up to date', 'info')
      return
    }
    await this.offer(update)
  }

  private async offer(update: AvailableUpdate): Promise<void> {
    this.busy = true
    try {
      if ((await this.deps.ask(update.version, update.notes)) !== 'update') return
      try {
        this.deps.progress(null)
        await update.download((f) => this.deps.progress(f))
      } catch (e) {
        console.error('Could not download the update', e)
        this.deps.notify('Could not download the update', 'error')
        return
      } finally {
        this.deps.progress(undefined)
      }
      await this.install(update)
    } finally {
      this.busy = false
    }
  }

  /** Closes the tabs like on exit, then runs the installer; a Cancel leaves a toast to try again. */
  private async install(update: AvailableUpdate): Promise<void> {
    if (!(await this.deps.quit())) {
      this.deps.notify(`JuliePDF ${update.version} is ready to install`, 'info', {
        label: 'Install',
        run: () => void this.install(update),
      })
      return
    }
    try {
      await update.install()
    } catch (e) {
      console.error('Could not install the update', e)
      this.deps.notify('Could not install the update', 'error')
    }
  }
}
