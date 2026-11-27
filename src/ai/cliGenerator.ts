/**
 * The explanation generator backed by the user's local Claude Code or Codex
 * CLI. Loaded with `import()` only when AI is used, never by eager modules.
 */
import { DEFAULT_LIMITS, type ChunkLimits } from './chunking'
import { cliCancel, cliGenerate, type CliConfig, type CliKind } from './cliIpc'
import type { ExplanationGenerator, GenerationOutcome, GenerationRequest } from './generator'

/** Codex answers slowly and tends to cut long runs short, so it gets smaller requests. */
export const CODEX_LIMITS: ChunkLimits = { ...DEFAULT_LIMITS, maxPages: 20, maxPictures: 20 }

export function limitsFor(cli: CliKind): ChunkLimits {
  return cli === 'codex' ? CODEX_LIMITS : DEFAULT_LIMITS
}

/**
 * Request ids are unique per app run, not per webview: the backend remembers
 * recently finished or cancelled ids, so a counter restarting at 0 after a
 * webview reload could collide with them. Seeded from the clock (kept far
 * below u32::MAX, the backend's id type).
 */
let nextId = (Date.now() % 1_000_000) * 1000

/** Codex reports a busy service as an error; Claude's CLI retries such errors itself. */
const TRANSIENT = /overloaded|429|503|529|try again/i
const RETRY_WAIT_MS = 5000

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const done = (ok: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(ok)
    }
    const onAbort = () => done(false)
    const timer = setTimeout(() => done(true), ms)
    signal.addEventListener('abort', onAbort)
  })
}

function messageOf(e: unknown): string {
  return typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string'
    ? (e as { message: string }).message
    : String(e)
}

export function cliGenerator(
  config: CliConfig,
  deps: { generate?: typeof cliGenerate; cancel?: typeof cliCancel } = {},
  /**
   * `pictures: false` for a model that cannot read them (some Codex models): only text is sent.
   * `defaultModel`: the model the CLI runs when none is chosen, from its model list.
   */
  opts: { pictures?: boolean; defaultModel?: string } = {},
): ExplanationGenerator {
  const pictures = opts.pictures ?? true
  /** The exact model the CLI named while running (Claude Code does, also for an alias or none). */
  let reported: string | null = null
  const generate = deps.generate ?? cliGenerate
  const cancel = deps.cancel ?? cliCancel
  const prefix = config.cli === 'codex' ? 'codex' : 'claude-code'

  /** One request; an abort asks the backend to stop it (once), and the backend then ends it as cancelled. */
  function attempt(request: GenerationRequest, onLine: (l: string) => void, signal: AbortSignal): Promise<GenerationOutcome> {
    const id = nextId++
    const onAbort = () => void cancel(id).catch(() => {})
    signal.addEventListener('abort', onAbort, { once: true })
    const onModel = (model: string) => (reported = model)
    return generate(id, config, request.system, request.user, pictures ? request.images : [], onLine, onModel).finally(() =>
      signal.removeEventListener('abort', onAbort),
    )
  }

  return {
    /**
     * Read when each explanation is saved. An exact model id stands alone
     * (`claude-sonnet-5-5` names its maker already): the one the CLI
     * reported, else for Codex the chosen one or the CLI's default. Only a
     * Claude alias or an unknown default keeps the CLI as prefix
     * (`claude-code:sonnet`, `codex:default`).
     */
    get model() {
      const exact = reported ?? (config.cli === 'codex' ? config.model || opts.defaultModel : undefined)
      return exact || `${prefix}:${config.model || 'default'}`
    },
    pictureNote: config.cli === 'codex' ? 'codex' : 'claude',
    pictures,
    async generate(request, onLine, signal) {
      if (signal.aborted) return 'cancelled'
      let delivered = false
      const track = (line: string) => {
        delivered = true
        onLine(line)
      }
      try {
        return await attempt(request, track, signal)
      } catch (e) {
        // A retry would repeat lines already delivered, so only a request that produced nothing is retried.
        if (config.cli !== 'codex' || delivered || !TRANSIENT.test(messageOf(e))) throw e
        if (!(await wait(RETRY_WAIT_MS, signal))) return 'cancelled'
        return attempt(request, track, signal)
      }
    },
  }
}
