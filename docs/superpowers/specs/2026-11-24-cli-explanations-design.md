# One-click explanations with a local AI CLI (#99): design

## Intent

The user wants one click on "Add explanations" to generate every page's
explanation (from #88) without an API key, using the AI command-line tool
they already have installed and logged into with their own subscription.
**Claude Code is the focus and gets the most care; Codex CLI is supported
too and must work just as reliably.** Explanation quality comes first:
the user picks the model in Settings, and the model list comes from the
installed CLI itself, never hard-coded in JuliePDF.

#88 (merged in #100) already provides the explanation fields, `/PieceInfo`
storage and the shared generation core in `src/ai/` (`generator.ts`
interface, `prompt.ts`, `parse.ts`, `chunking.ts`, `retry.ts`,
`runs.svelte.ts`, `generate.ts`, `action.ts`). #99 adds a generator, the
**AI (Beta)** settings category and the status-bar controls. Nothing in
storage, prompt or parsing is duplicated.

## Goals

- One click generates explanations through `claude -p` (default) or
  `codex exec`, streaming them into the fields as they arrive.
- Settings → AI (Beta): turn AI on, pick the CLI, pick the model (and
  effort for Claude), see whether the CLI was found and its version, a
  Test button, and a short "use at your own risk" note.
- Model list loaded from the CLI on demand; robust fallback when that
  fails.
- Clear, actionable errors: not installed, not logged in, plan limit
  reached, timeout. Prefer the CLI's own message (it already names the
  exact fix, e.g. "Run `claude auth login` to sign in again").
- Locked down: the CLI must not be able to run commands, read or edit
  files, or use MCP servers, because PDF text can contain instructions
  aimed at the model.

## Non-goals

- Claude Desktop / MCP (#98). Antigravity CLI (to investigate separately).
- API keys, a backup provider (the API-key branch had one; the CLI route
  doesn't need it).
- Keeping a CLI process alive between runs (would cost memory the whole
  time the app is open; ~0.6 s startup per run is acceptable).
- Logging the user in, or touching any login token. JuliePDF only starts
  the user's own, unmodified CLI.

## Anti-goals

- Anything that slows startup or the drawing/rendering paths: nothing of
  this runs or loads until AI is turned on and the user clicks (or opens
  the AI settings page).
- A long legal wall in the UI. The user asked for a short disclaimer.
- Running the CLI in the PDF's folder or with any tool enabled.

## Constraints

- Windows; Tauri 2 + Svelte 5; Rust backend. No shell plugin, no new
  Tauri permission: `std::process::Command` from Rust.
- No new crate. `tauri::async_runtime` (tokio, already in the tree via
  Tauri) for async/blocking work; `serde_json` for the event streams.
- Performance (CLAUDE.md): process start happens only on click; output is
  read off the main thread; the frontend AI code stays lazy-loaded
  (`import()` on click), as `generate.ts` already expects.
- Every feature comes with tests (vitest + cargo).

## Approaches

1. **Rust spawns the CLI per request, parses its JSON event stream, and
   sends answer lines to the frontend over a Tauri `Channel`** (chosen).
   Matches the issue, needs no permission or crate, Cancel kills the
   process, and parsing per CLI is pure and unit-testable in Rust.
2. Tauri shell plugin from the frontend: needs a new plugin and
   permission scope; ruled out by the issue.
3. One long-lived `claude` process (stream-json input) reused across
   runs: saves ~0.6 s per click but keeps a Node process (~100+ MB)
   resident; against the performance goal.

## Findings from probing Claude Code 2.1.331 on this machine

- Locked-down command that works (first text after ~2 s, two pages in
  ~8 s with Opus/high effort):
  `claude -p --output-format stream-json --verbose --include-partial-messages
  --tools "" --no-session-persistence --strict-mcp-config --setting-sources ""
  --disable-slash-commands --system-prompt <SYSTEM_PROMPT> --model <m> [--effort <e>]`,
  user prompt on stdin.
  - `--tools ""` disables every built-in tool; `--strict-mcp-config` with
    no `--mcp-config` loads no MCP servers; `--setting-sources ""` skips
    user/project settings, hooks and CLAUDE.md; `--system-prompt` replaces
    Claude Code's coding-agent prompt with #88's `SYSTEM_PROMPT`.
  - Do **not** use `--bare`: it refuses OAuth (subscription) logins.
- Streaming: with `--include-partial-messages`, `stream_event` lines carry
  `content_block_delta` / `text_delta` pieces of the answer. Feed those to
  a line splitter (the API-key branch's `LineSplitter` in
  `src-tauri/src/ai/stream.rs` can be reused) to get complete JSON lines.
  The final `{"type":"result", ...}` line has `is_error`, `result` (an
  error message when `is_error`), `stop_reason` and `api_error_status`.
  `stop_reason: "max_tokens"` → outcome `truncated`.
- Errors observed: an expired login produces `system/api_retry` lines
  (`error_status: 401`) and then a `result` with `is_error: true` and a
  readable message such as "Failed to authenticate: this login reached its
  time limit and cannot be renewed. Run `claude auth login` to sign in
  again…". There is also a `rate_limit_event` line with a `status`
  (seen: `allowed`), usable to detect a reached plan limit.
- **Environment:** when JuliePDF is started from a Claude Code session
  (e.g. `npm run tauri dev` inside one), inherited variables such as
  `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_SIMPLE`, `CLAUDECODE`,
  `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH` and `CLAUDE_CODE_ENTRYPOINT`
  make the child CLI fail authentication. *(Designer's call:)* only when
  `CLAUDECODE` is present in JuliePDF's own environment (it was started
  from a Claude Code session), remove a fixed list of session-injected
  variables from the child's environment: `CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SIMPLE`,
  `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, `CLAUDE_CODE_CHILD_SESSION`,
  `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_HOST_SESSION_ID`,
  `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`,
  `CLAUDE_CODE_ACCOUNT_UUID`, `CLAUDE_CODE_ORGANIZATION_UUID` and
  `ANTHROPIC_BASE_URL`. Otherwise the environment is passed unchanged, so
  deliberate user settings (`CLAUDE_CODE_OAUTH_TOKEN`,
  `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_GIT_BASH_PATH`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, a proxy in `ANTHROPIC_BASE_URL`) keep
  working for normal launches.
- **Model list:** Claude Code has no `models` command, but answers the
  Agent SDK's initialize control request, without needing a valid login:
  start `claude -p --input-format stream-json --output-format stream-json
  --verbose --tools "" --no-session-persistence --strict-mcp-config
  --setting-sources ""`, write
  `{"type":"control_request","request_id":"<id>","request":{"subtype":"initialize"}}`
  plus newline to stdin, read until the `control_response` with that id,
  then kill the process. Its `models` array has `value`, `displayName`,
  `description`, and optionally `supportsEffort` and
  `supportedEffortLevels`. The list depends on the installed CLI version
  (2.1.140 listed "Opus 4.7", 2.1.331 lists Opus 5.5 as Default) and
  contains aliases (`default`, `opus`, `fable`, `sonnet`, `haiku`) plus
  pinned versions (`claude-opus-5`, `claude-sonnet-4-6`, …). This request
  is not officially documented, so it may change.
- `claude --version` prints e.g. `2.1.331 (Claude Code)`.

## Findings from probing Codex CLI 0.172.0 on this machine

Installed with npm (`C:\nvm4w\nodejs\codex.cmd`, a `.cmd` shim), logged in
with ChatGPT.

- Locked-down command that works (3 pages in ~11 s with
  `gpt-6.2-astra`, high effort):
  `codex exec --json --ephemeral --ignore-user-config --ignore-rules
  --skip-git-repo-check --sandbox read-only --disable shell_tool
  --disable unified_exec --disable apps --disable browser_use
  --disable code_mode_host -c web_search="disabled"
  -c approval_policy="never" -c developer_instructions=<SYSTEM_PROMPT>
  [-m <model>] [-c model_reasoning_effort=<e>] -`, user prompt on stdin.
  - `--ignore-user-config` skips `~/.codex/config.toml` (and its MCP
    servers); login still works. `--ephemeral` saves no session.
  - With `shell_tool`, `unified_exec` and `code_mode_host` disabled the
    model has no way to run commands or read files: asked to read a file
    outside the working directory, its `exec` tool failed closed ("tool
    host is disabled"). Remaining tools (`apply_patch` under a read-only
    sandbox, goals, `view_image`, image generation, collaboration/agent
    tools) cannot touch the disk or the network in a harmful way. So
    Codex meets the same lockdown goal as Claude, and the disclaimer needs
    no extra Codex line.
  - `developer_instructions` carries #88's `SYSTEM_PROMPT` (TOML string;
    escape it properly when building the `-c` value).
- Events (JSONL on stdout): `thread.started`, `turn.started`,
  `item.completed` with `item.type == "agent_message"` and `item.text`
  (the whole answer at once; **no text deltas**), `turn.completed` with
  `usage`. An `item.completed` with `item.type == "error"` appears at
  startup ("Code Mode is unavailable because code-mode host is
  disabled…"): informational, must be ignored. Fatal errors come as
  `turn.failed` or a top-level `{"type":"error"}`; the builder confirms
  their exact shape (e.g. by running while logged out).
- Because the answer arrives in one piece, fields only fill when a
  request finishes. *(Designer's call:)* use smaller chunks for Codex
  (about 20 pages per request) so a long document fills in steps and
  progress moves; Claude keeps #88's defaults.
- Model list: `codex app-server` (JSON-RPC over stdio). Send
  `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"juliepdf","version":"<v>"}}}`,
  then `{"jsonrpc":"2.0","method":"initialized"}`, then
  `{"jsonrpc":"2.0","id":2,"method":"model/list","params":{}}`; read
  until the response with `id` 2, then kill the process. Ignore
  notifications (`remoteControl/status/changed`, `account/updated`, …).
  `result.data[]` has `model`, `displayName`, `description`, `hidden`,
  `isDefault`, `supportedReasoningEfforts[].reasoningEffort`,
  `defaultReasoningEffort`. Skip `hidden` models. Seen: GPT-6.2-Sol
  (default), GPT-6.2-Astra ("most capable"), GPT-6.1 Terra.
  *(Designer's call:)* default Codex model = the one described as most
  capable is not detectable reliably, so default to "CLI default" (no
  `-m`) with effort `high`; the user picks e.g. Astra in Settings.
- `codex --version` prints e.g. `codex-cli 0.172.0`.
- Codex is fully supported and shown like Claude in the UI (no
  "untested" or "experimental" label).

## Design

### Backend: `src-tauri/src/ai/` (new module)

- `discover.rs`: find the executable for `claude` / `codex`: a custom
  path from settings if set, else search `PATH` (with `PATHEXT`), which
  covers `claude.exe` in `~/.local/bin` and npm `.cmd` shims for Codex.
  A `.cmd` shim must be started through `cmd /C` (Rust refuses to run
  batch files directly with arbitrary args; quote carefully) or, better,
  resolved to the `node` + script it wraps; builder's call, with a test.
  Also check the usual install locations when `PATH` lacks them (the
  app may be started from Explorer with a shorter `PATH`): 
  `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`.
- `cli.rs`: building the command per CLI (args above, empty temp working
  directory created per run under the system temp dir and removed after,
  cleaned environment, `CREATE_NO_WINDOW` so no console window flashes),
  writing the prompt to stdin, reading stdout line by line on a blocking
  task, stderr captured (last few KB) for error messages.
- `events.rs`: pure parsers, one per CLI, from an output line to events:
  `Text(String)` (a piece of answer text), `Finished { truncated }`,
  `Error(String)`, `RateLimited(String)`, ignore the rest. Unit-tested
  with recorded lines (the Claude and Codex lines above). For Codex the
  whole `agent_message` text goes through the same line splitter.
- `models.rs`: the model-list requests (Claude initialize, Codex
  `model/list`) with a timeout (~15 s), returning
  `{ value, label, description, efforts: string[] }`.
- Commands (registered in `lib.rs`):
  - `ai_cli_info(cli, customPath)` → `{ found, path, version }`.
  - `ai_cli_models(cli, customPath)` → model list (or an error; the UI
    falls back).
  - `ai_cli_generate(requestId, config, system, user, onLine: Channel)` →
    `'done' | 'truncated' | 'cancelled'` or an `AppError` with a readable
    message. `config = { cli, path, model, effort }`.
  - `ai_cli_cancel(requestId)` kills the process (and its tree: a `.cmd`
    shim's child `node` too; `taskkill /T /F /PID` or a job object).
- Errors: new `AppError` variant(s), e.g. `AiCli(String)`, carrying a
  user-facing message:
  - executable not found → "Claude Code was not found. Install it, or set
    its path in Settings → AI."
  - `result.is_error` → the CLI's `result` text as-is.
  - process exits non-zero with no result → last stderr line(s).
  - no output for a long time → timeout (e.g. 120 s of silence; the
    whole run has no fixed limit because large documents take minutes).
  - Transient overload (`api_error_status` 429/529 or "overloaded"): the
    Claude CLI already retries internally (it emitted `api_retry` with
    `max_retries: 10`), so JuliePDF does not add its own retry for Claude;
    for Codex, one automatic retry of the chunk after a short wait.

### Frontend

- `src/ai/cliGenerator.ts`: an `ExplanationGenerator` that calls
  `ai_cli_generate` with a new request id, forwards channel lines to
  `onLine`, and on `signal` abort calls `ai_cli_cancel`. `model` (recorded
  with each explanation) is e.g. `claude-code:opus` or
  `codex:<model>`.
- Chunking: Claude keeps #88's defaults (150 pages, 32k output tokens;
  the builder may lower `maxPages` if long runs hit output limits). Codex
  uses ~20 pages per request (see the Codex findings).
- Settings (`src/core/settings/preferences.ts`): `aiEnabled` (flag, off),
  `aiCli` (`'claude' | 'codex'`, default `'claude'`), `aiClaudeModel`
  (text, default `'opus'`), `aiClaudeEffort` (text, default `'high'`;
  `''` = CLI default), `aiCodexModel` (text, default `''` = CLI default),
  `aiCodexEffort` (text, default `'high'`), `aiClaudePath` /
  `aiCodexPath` (text, default `''` = find it).
- `src/ui/SettingsDialog.svelte`: new **AI (Beta)** category (icon
  `Sparkles`). Panel in its own lazily loaded component
  (`src/ai/AiSettingsPanel.svelte`, adapted from the API-key branch):

  ```
  AI explanations (Beta)          [ On | Off ]
  Generate with                   [ Claude Code | Codex CLI ]
    ✓ Claude Code 2.1.331 found          (or: ✗ not found + Browse…)
  Model                           [ Opus — Best for everyday, complex tasks ▾ ]
  Effort                          [ High ▾ ]   (only if the model supports it)
                                  [ Test ]
  Uses your own Claude/ChatGPT subscription through its CLI. Use at your
  own risk: the provider may not allow this, may limit or stop it.
  The document's text is sent to the provider when you generate.
  ```

  - Model dropdown: aliases first (in the CLI's order), then a "More
    versions" group with pinned ones; each option shows `displayName — 
    description`. A stored model that is not in the list stays selectable
    (shown as-is) so a pinned choice never silently changes.
  - Effort dropdown: "CLI default" plus the model's effort levels
    (Claude `supportedEffortLevels`, Codex
    `supportedReasoningEfforts`); hidden for models without effort.
    *(Designer's call:)* leave out Codex's `ultra` ("automatic task
    delegation" spawns agents, pointless for this and costly).
  - The info, version and model list load when the AI page opens (and on
    switching CLI), once per app session (cached in memory). On failure:
    the aliases `default`, `opus`, `sonnet`, `haiku` for Claude / "CLI
    default" for Codex, plus a free-text field for any other model name,
    and a small note that the list could not be loaded.
  - Test runs a tiny prompt (one fake page) through the real generate
    path and shows "Works" or the error message.
  - Disclaimer: the three short sentences above, nothing more. The same
    for both CLIs.
- Status bar (`src/app/StatusBar.svelte`): when AI is on and a document is
  open, show `AiControls.svelte` (from the API-key branch, minus the
  backup provider): "Add explanations" / "Regenerate explanations" (with
  #88's confirm, via `ConfirmDialog.svelte` from that branch), progress
  "Explaining 12/40" with Cancel, or the stop message with Retry. Show
  "Starting Claude…" during the ~1–2 s before the first line so the click
  feels instant. `startGeneration.ts` loads `generate.ts` and
  `cliGenerator.ts` with `import()` on click.
- Tooltip on the button names the CLI and model ("…with Claude Code,
  Opus").

## Tests

- Rust: `events.rs` parsers (deltas split across lines, result success /
  error / max_tokens, rate limit, junk lines; Codex events including the
  harmless startup `error` item), line splitting, environment cleaning,
  command arguments per CLI (assert every lockdown flag is present:
  `--tools ""`, `--strict-mcp-config`, `--setting-sources ""` for Claude;
  `--ignore-user-config`, `--disable shell_tool`, `--disable
  unified_exec`, `--disable code_mode_host`, read-only sandbox for
  Codex), discovery with a fake `PATH`, model-list parsing from a
  recorded Claude `control_response` and Codex `model/list` response. A test with a fake CLI
  (a tiny script/exe that prints recorded lines) for spawn + cancel if
  practical.
- TS: `cliGenerator` (lines forwarded, abort → cancel, errors rejected
  with messages), preferences defaults/validation, settings panel (list
  shown, fallback on failure, effort hidden for haiku, disclaimer
  present), `AiControls` states, `startGeneration` confirm flow.

## Left to the builder

- Exact shape of Codex's fatal error events (`turn.failed`, `error`).
- How to start `.cmd` shims safely, and killing the process tree.
- Whether `rate_limit_event` statuses other than `allowed` need their own
  message, or the final `result` error already says it.
- Small UI wording, icons and layout within the existing dialog style.
