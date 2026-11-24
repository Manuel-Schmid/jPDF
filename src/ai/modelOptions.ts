/**
 * Turning the CLI's own model list into what the settings page shows. The
 * lists come from the CLIs (see cliIpc.ts), so nothing here names a model
 * version; only the shape of the ids is used.
 */
import type { CliKind, CliModel } from './cliIpc'

export interface ModelGroups {
  /** Shown first. */
  main: CliModel[]
  /** Under "More versions". */
  more: CliModel[]
}

/** No digit once a context suffix such as `[1m]` is set aside: `sonnet[1m]` is an alias, `claude-sonnet-4-6` is not. */
const isAlias = (value: string) => !/\d/.test(value.replace(/\[.*\]$/, ''))

/**
 * Claude lists a few aliases (`default`, `opus`, `sonnet[1m]` …) followed by
 * many pinned versions (`claude-sonnet-4-6`); an alias has no digit, which
 * keeps the short list on top without knowing today's model names. Codex ids
 * all carry digits, so there every model is a main entry, preceded by "CLI
 * default" (no `-m`), which offers the efforts of the CLI's default model.
 */
export function groupModels(models: CliModel[], cli: CliKind): ModelGroups {
  if (cli === 'codex') {
    const efforts = models.find((x) => x.isDefault)?.efforts ?? []
    const none: CliModel = { value: '', label: 'CLI default', description: '', efforts, isDefault: false }
    return { main: [none, ...models], more: [] }
  }
  return { main: models.filter((x) => isAlias(x.value)), more: models.filter((x) => !isAlias(x.value)) }
}

/** Keeps a stored model the CLI no longer lists (retired, or typed by hand) selectable. */
export function withStored(groups: ModelGroups, stored: string): ModelGroups {
  if (stored === '' || [...groups.main, ...groups.more].some((x) => x.value === stored)) return groups
  const extra: CliModel = { value: stored, label: stored, description: '', efforts: [], isDefault: false }
  return { main: groups.main, more: [...groups.more, extra] }
}

/** The reasoning efforts `value` supports; none for an unknown model (the effort control is then hidden). */
export function effortsFor(models: CliModel[], value: string): string[] {
  return models.find((x) => x.value === value)?.efforts ?? []
}

const ALL = ['low', 'medium', 'high', 'max']
const entry = (value: string, label: string, efforts: string[]): CliModel => ({
  value, label, description: '', efforts, isDefault: false,
})

/** Shown when the CLI cannot list its models (offline, old version): common choices only. */
export const FALLBACK: Record<CliKind, CliModel[]> = {
  claude: [entry('default', 'Default', ALL), entry('opus', 'Opus', ALL), entry('sonnet', 'Sonnet', ALL), entry('haiku', 'Haiku', [])],
  codex: [entry('', 'CLI default', ['low', 'medium', 'high', 'xhigh'])],
}
