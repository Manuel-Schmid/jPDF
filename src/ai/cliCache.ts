/**
 * What the CLIs reported about themselves, kept for the app session. The CLI
 * is spawned only when Settings → AI opens, and once per CLI and executable:
 * reopening Settings reuses the answers. A CLI that was not found, or whose
 * list failed, is not kept, so reopening the page after installing or fixing
 * it asks again. Loaded with `import()` (it reaches cliIpc), never eagerly.
 */
import { cliInfo, cliModels, type CliInfo, type CliKind, type CliModel } from './cliIpc'
import { groupModels, picturesFor } from './modelOptions'

const infoCache = new Map<string, Promise<CliInfo>>()
const modelsCache = new Map<string, Promise<CliModel[]>>()
/** The resolved model lists, so a generation can ask synchronously without spawning a CLI. */
const knownModels = new Map<string, CliModel[]>()

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

export const lookupInfo = (cli: CliKind, path: string) =>
  cached(infoCache, `${cli}|${path}`, () => cliInfo(cli, path), (v) => v.found)

export const lookupModels = (cli: CliKind, path: string) =>
  cached(
    modelsCache,
    `${cli}|${path}`,
    async () => {
      const list = await cliModels(cli, path)
      knownModels.set(`${cli}|${path}`, list)
      return list
    },
    () => true,
  )

/**
 * Whether `model` can read page pictures, as far as the cached model list
 * says; undefined when that list was never loaded (Settings not opened yet).
 * Never starts the CLI.
 */
export function knownPictureSupport(cli: CliKind, path: string, model: string): boolean | undefined {
  const list = knownModels.get(`${cli}|${path}`)
  if (!list) return undefined
  const g = groupModels(list, cli)
  return picturesFor([...g.main, ...g.more], model)
}

/** Forgets what was looked up (tests; nothing else needs it). */
export function resetAiCache() {
  infoCache.clear()
  modelsCache.clear()
  knownModels.clear()
}
