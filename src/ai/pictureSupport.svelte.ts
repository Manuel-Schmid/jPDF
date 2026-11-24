/**
 * Which models can read page pictures, from the model lists the CLIs gave
 * this app session (Settings → AI, or a generation's lookup; see
 * cliCache.ts). Kept apart from cliCache.ts on purpose: the status bar
 * (loaded eagerly) asks it for the generate button's tooltip, and must not
 * load cliCache.ts or cliIpc.ts. Reactive, so the tooltip follows a list that
 * arrives later. Never starts a CLI.
 */
import { SvelteMap } from 'svelte/reactivity'
import type { CliKind, CliModel } from './cliIpc'
import { groupModels, picturesFor } from './modelOptions'

const knownModels = new SvelteMap<string, CliModel[]>()

/** Keeps a CLI's resolved model list (cliCache.ts calls this). */
export function rememberModels(cli: CliKind, path: string, list: CliModel[]): void {
  knownModels.set(`${cli}|${path}`, list)
}

/**
 * Whether `model` can read page pictures, as far as the known model list
 * says; undefined when that list was never loaded (Settings not opened yet).
 */
export function knownPictureSupport(cli: CliKind, path: string, model: string): boolean | undefined {
  const list = knownModels.get(`${cli}|${path}`)
  if (!list) return undefined
  const g = groupModels(list, cli)
  return picturesFor([...g.main, ...g.more], model)
}

/** Forgets the lists (resetAiCache, for tests). */
export function forgetModels(): void {
  knownModels.clear()
}
