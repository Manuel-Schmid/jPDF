/**
 * What the CLIs reported about themselves, kept for the app session. The CLI
 * is spawned only when Settings → AI opens, and once per CLI and executable:
 * reopening Settings reuses the answers. A CLI that was not found, or whose
 * list failed, is not kept, so reopening the page after installing or fixing
 * it asks again. Loaded with `import()` (it reaches cliIpc), never eagerly.
 */
import { cliInfo, cliModels, type CliInfo, type CliKind, type CliModel } from './cliIpc'
import { forgetModels, rememberModels } from './pictureSupport.svelte'

export { knownPictureSupport } from './pictureSupport.svelte'

const infoCache = new Map<string, Promise<CliInfo>>()
const modelsCache = new Map<string, Promise<CliModel[]>>()
/**
 * CLIs whose model list could not be had. Settings still asks again when it
 * opens (the CLI may have been installed or fixed since); a generation does
 * not, so every click on Add explanations doesn't wait for the same failure.
 */
const failedModels = new Set<string>()

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>, keep: (v: T) => boolean): Promise<T> {
  let p = map.get(key)
  if (!p) {
    p = load()
    map.set(key, p)
    p.then(
      (v) => keep(v) || map.delete(key),
      () => map.delete(key),
    )
  }
  return p
}

/** Kept only once it is usable: not found or not signed in is asked again (the user may be fixing it). */
export const lookupInfo = (cli: CliKind, path: string) =>
  cached(infoCache, `${cli}|${path}`, () => cliInfo(cli, path), (v) => v.found && v.signedIn !== false)

/** Settings' "Check again": forgets what is known about this CLI, so the next lookup asks it again. */
export function forgetCli(cli: CliKind, path: string): void {
  const key = `${cli}|${path}`
  infoCache.delete(key)
  modelsCache.delete(key)
  failedModels.delete(key)
}

export const lookupModels = (cli: CliKind, path: string) =>
  cached(
    modelsCache,
    `${cli}|${path}`,
    async () => {
      const key = `${cli}|${path}`
      try {
        const list = await cliModels(cli, path)
        // Kept so a generation and the tooltip can ask synchronously without spawning a CLI.
        rememberModels(cli, path, list)
        failedModels.delete(key)
        return list
      } catch (e) {
        failedModels.add(key)
        throw e
      }
    },
    () => true,
  )

/** Whether listing this CLI's models failed this app session (and has not succeeded since). */
export function modelLookupFailed(cli: CliKind, path: string): boolean {
  return failedModels.has(`${cli}|${path}`)
}

/** Forgets what was looked up (tests; nothing else needs it). */
export function resetAiCache() {
  infoCache.clear()
  modelsCache.clear()
  forgetModels()
  failedModels.clear()
}
