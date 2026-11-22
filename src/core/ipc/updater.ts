import { check, type DownloadEvent } from '@tauri-apps/plugin-updater'
import type { AvailableUpdate } from '../../app/updates.svelte'

/**
 * The newer release on GitHub, or null when this is the latest version.
 * Reads the `latest.json` of the latest release (tauri.conf.json → plugins.updater);
 * rejects when offline or the file can't be read.
 */
export async function checkRelease(): Promise<AvailableUpdate | null> {
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    notes: update.body?.trim() || undefined,
    // The plugin verifies the installer's signature against the public key
    // in tauri.conf.json before it can be installed.
    download: (progress) => update.download(downloadProgress(progress)),
    // Windows: the installer runs passively and the app exits as it starts.
    install: () => update.install(),
  }
}

/**
 * Turns the plugin's download events into a fraction 0..1 for `report`, or
 * null while the size is unknown (no Content-Length).
 */
export function downloadProgress(report: (fraction: number | null) => void): (e: DownloadEvent) => void {
  let total: number | undefined
  let received = 0
  return (e) => {
    if (e.event === 'Started') {
      total = e.data.contentLength || undefined
      received = 0
      report(total ? 0 : null)
    } else if (e.event === 'Progress') {
      received += e.data.chunkLength
      report(total ? Math.min(1, received / total) : null)
    } else {
      report(1)
    }
  }
}
