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

/**
 * Cache key of a CLI as run: with a saved token it may answer differently
 * (signed in). The token itself is never part of the key; a new token
 * forgets the old answers (forgetCli).
 */
const keyOf = (cli: CliKind, path: string, token: string) => `${cli}|${path}|${token ? 'token' : ''}`

/** Kept only once it is usable: not found or not signed in is asked again (the user may be fixing it). */
export const lookupInfo = (cli: CliKind, path: string, token = '') =>
  cached(infoCache, keyOf(cli, path, token), () => cliInfo(cli, path, token), (v) => v.found && v.signedIn !== false)

/** Settings' "Check again" (and a saved token): forgets what is known about this CLI, so the next lookup asks it again. */
export function forgetCli(cli: CliKind, path: string): void {
  for (const token of ['', 'token']) {
    const key = keyOf(cli, path, token)
    infoCache.delete(key)
    modelsCache.delete(key)
    failedModels.delete(key)
  }
}

export const lookupModels = (cli: CliKind, path: string, token = '') =>
  cached(
    modelsCache,
    keyOf(cli, path, token),
    async () => {
      const key = keyOf(cli, path, token)
      try {
        const list = await cliModels(cli, path, token)
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
export function modelLookupFailed(cli: CliKind, path: string, token = ''): boolean {
  return failedModels.has(keyOf(cli, path, token))
}

/** Forgets what was looked up (tests; nothing else needs it). */
export function resetAiCache() {
  infoCache.clear()
  modelsCache.clear()
  forgetModels()
  failedModels.clear()
}
