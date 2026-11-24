# One-click CLI Explanations (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on "Add explanations" runs the user's own Claude Code (focus) or Codex CLI, locked down, and streams page explanations into #88's fields.

**Architecture:** Rust (`src-tauri/src/ai/`) finds the CLI, spawns it per request with `std::process::Command` (locked-down args, empty temp dir, cleaned env, no window), parses its JSON event stream into answer lines and sends them over a Tauri `Channel`. The frontend adds an `ExplanationGenerator` (`cliGenerator.ts`) for #88's existing `generateExplanations`, the status-bar controls and a Settings → AI (Beta) panel whose model list comes from the CLI.

**Tech Stack:** Tauri 2, Rust (std process, serde_json, `tauri::async_runtime`), Svelte 5, TypeScript, vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-24-cli-explanations-design.md` (read it first: the exact CLI commands, event shapes and model-list handshakes are in its two "Findings" sections and are not repeated here).

## Global Constraints

- Work in the worktree `C:\Users\manys\projects\juliepdf-99`, branch `feat/99-cli-explanations`. Run `npm ci` there once before the first vitest run.
- No new crate, no new npm package, no Tauri plugin or permission.
- Nothing runs or loads until AI is on and the user clicks or opens Settings → AI: frontend AI code beyond `runs.svelte.ts`, `action.ts`, `AiControls.svelte` is loaded with `import()`.
- Every spawned CLI: working dir = fresh empty dir under `std::env::temp_dir()` (removed afterwards), `CREATE_NO_WINDOW` (0x0800_0000), stdin = prompt, never the PDF's folder.
- Claude generate args (exact): `-p --output-format stream-json --verbose --include-partial-messages --tools "" --no-session-persistence --strict-mcp-config --setting-sources "" --disable-slash-commands --system-prompt <system> --model <model> [--effort <effort>]`. Never `--bare`.
- Codex generate args (exact): `exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only --disable shell_tool --disable unified_exec --disable apps --disable browser_use --disable code_mode_host -c web_search="disabled" -c approval_policy="never" -c developer_instructions=<TOML string of system> [-m <model>] [-c model_reasoning_effort="<effort>"] -`.
- Env cleaning only when JuliePDF's own env has `CLAUDECODE`: remove `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_HOST_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_ACCOUNT_UUID`, `CLAUDE_CODE_ORGANIZATION_UUID`, `ANTHROPIC_BASE_URL`.
- Defaults: CLI `claude`; Claude model `opus`, effort `medium`; Codex model `''` (CLI default), effort `medium`. Codex effort `ultra` is never offered.
- Disclaimer copy (exact, both CLIs): "Uses your own Claude or ChatGPT subscription through its command-line tool. Use at your own risk: the provider may not allow this, and may limit or stop it. The document's text is sent to the provider when you generate."
- Codex chunk limits: `maxPages: 20` (other fields as `DEFAULT_LIMITS`); Claude uses `DEFAULT_LIMITS`.
- Silence timeouts: Claude 120 s, Codex 300 s without any stdout line → error "<CLI name> stopped responding."
- Commits: conventional subjects, short body, the user's git identity only, **no `Co-Authored-By` or other Claude attribution** (CLAUDE.md).
- Comments explain intent and edge cases, in the existing doc-comment style.

## Review Focus

1. **PDF text with instructions aimed at the model** must not let the CLI run commands or read files → Task 1 asserts every lockdown flag in the built args (a dropped flag fails a test).
2. **App started from Explorer with a short `PATH`** (CLI in `%USERPROFILE%\.local\bin` or `%APPDATA%\npm` only) must still find it → Task 3 test with a fake home and empty `PATH`.
3. **Cancel during a Codex run** must also end the `node` → `codex.exe` children, not just the shim → Task 4 uses `taskkill /T /F`, test asserts the fake child process tree is gone.
4. **Expired login / plan limit** must show the CLI's own message, not "exit code 1" → Task 2 parser test with the recorded Claude `is_error` result, Task 4 test that it becomes the `AppError` message.
5. **System prompt with quotes and line breaks** must reach the CLI intact (no `cmd /C` quoting) → Task 3 resolves npm `.cmd` shims to `node` + script; Task 1 test that `developer_instructions` is valid TOML for a prompt with `"`, `\` and newlines.

---

### Task 1: CLI kinds, lockdown args and environment (Rust, pure)

**Files:**
- Create: `src-tauri/src/ai/mod.rs` (module doc + `pub mod args; pub mod events; pub mod discover; pub mod run; pub mod models;` — add each `mod` line in the task that creates it)
- Create: `src-tauri/src/ai/args.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod ai;`)
- Modify: `src-tauri/src/error.rs` (variant `#[error("AI CLI: {0}")] AiCli(String)`), `src/core/ipc/api.ts` (`'AiCli'` in `AppErrorCode` and `CODES`)

**Interfaces:**
- Produces:
  - `#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)] #[serde(rename_all = "lowercase")] pub enum CliKind { Claude, Codex }` with `fn name(self) -> &'static str` ("Claude Code" / "Codex CLI") and `fn silence_timeout(self) -> Duration` (120 s / 300 s).
  - `#[derive(Deserialize)] #[serde(rename_all = "camelCase")] pub struct CliConfig { pub cli: CliKind, pub path: String /* '' = find */, pub model: String /* '' = CLI default */, pub effort: String /* '' = CLI default */ }`
  - `pub fn generate_args(cfg: &CliConfig, system: &str) -> Vec<String>`
  - `pub fn models_args(kind: CliKind) -> Vec<String>` (Claude: `-p --input-format stream-json --output-format stream-json --verbose --tools "" --no-session-persistence --strict-mcp-config --setting-sources ""`; Codex: `app-server`)
  - `pub const SESSION_VARS: &[&str]` (the list in Global Constraints) and `pub fn env_removals(own_env: impl Iterator<Item = (String, String)>) -> Vec<String>` (empty unless `CLAUDECODE` is present; then the `SESSION_VARS` that are present).

- [ ] **Step 1: Write failing tests** in `args.rs` `#[cfg(test)]`:
  - `claude_args_are_locked_down`: `generate_args(Claude, model "opus", effort "medium")` contains, in order pairs, `"--tools",""`, `"--strict-mcp-config"`, `"--setting-sources",""`, `"--no-session-persistence"`, `"--disable-slash-commands"`, `"--system-prompt",<system>`, `"--model","opus"`, `"--effort","medium"`; does not contain `"--bare"`.
  - `claude_omits_empty_model_and_effort`: no `--model` / `--effort` when empty.
  - `codex_args_are_locked_down`: contains `"--ignore-user-config"`, `"--ignore-rules"`, `"--ephemeral"`, `"--sandbox","read-only"`, `"--disable","shell_tool"`, `"--disable","unified_exec"`, `"--disable","code_mode_host"`, `"--disable","apps"`, `"--disable","browser_use"`, `"-c","web_search=\"disabled\""`, `"-c","approval_policy=\"never\""`, ends with `"-"`; `-m`/`model_reasoning_effort` only when set.
  - `codex_instructions_are_a_valid_toml_string`: for `system = "a \"q\" \\ b\nc"`, the `developer_instructions=` value after the `=` parses with `serde_json::from_str::<String>` back to `system` (JSON string escapes are valid TOML basic-string escapes).
  - `env_untouched_outside_claude_code`: `env_removals` of `[("ANTHROPIC_BASE_URL","x"),("CLAUDE_CODE_OAUTH_TOKEN","t")]` is empty.
  - `env_cleaned_inside_claude_code`: with `CLAUDECODE=1`, `CLAUDE_CODE_SIMPLE=1`, `ANTHROPIC_BASE_URL=x`, `CLAUDE_CODE_OAUTH_TOKEN=t` → removals are exactly `CLAUDECODE`, `CLAUDE_CODE_SIMPLE`, `ANTHROPIC_BASE_URL` (token kept).
- [ ] **Step 2:** `cargo test ai::args` in `src-tauri/` → FAIL (module missing).
- [ ] **Step 3:** Implement the items above; Codex instructions = `format!("developer_instructions={}", serde_json::to_string(system)?)`. Add `AiCli` to `AppError` and the TS code list.
- [ ] **Step 4:** `cargo test ai::args` → PASS; `cargo clippy --all-targets` clean; `npm run check` clean.
- [ ] **Step 5:** Commit `feat: locked-down command lines for the Claude and Codex CLIs`.

### Task 2: Event-stream parsers (Rust, pure)

**Files:**
- Create: `src-tauri/src/ai/events.rs`

**Interfaces:**
- Consumes: `CliKind`.
- Produces:
  - `#[derive(Debug, PartialEq)] pub enum Event { Text(String), Finished { truncated: bool }, Failed(String) }`
  - `pub fn parse_line(kind: CliKind, line: &str) -> Option<Event>`
  - `pub struct LineSplitter` with `feed(&mut self, text: &str) -> Vec<String>` and `finish(&mut self) -> Option<String>` — copy from `feat/ai-explanations-apikey:src-tauri/src/ai/stream.rs` with its tests.

Mapping (Claude): `stream_event` whose `event.type == "content_block_delta"` and `event.delta.type == "text_delta"` → `Text(event.delta.text)`; `result` with `is_error: true` → `Failed(result)` (fallback `"Claude Code failed (API error <api_error_status>)."` if `result` is empty); `result` otherwise → `Finished { truncated: stop_reason == "max_tokens" }`; everything else (`system/*`, `api_retry`, `assistant`, `rate_limit_event`, junk) → `None`.
Mapping (Codex): `item.completed` with `item.type == "agent_message"` → `Text(item.text + "\n")`; `item.completed` with `item.type == "error"` → `None` (startup notice); `turn.completed` → `Finished { truncated: false }`; `turn.failed` → `Failed(error.message)`; top-level `type == "error"` → `Failed(message)`; else `None`.

- [ ] **Step 1: Write failing tests** with the recorded lines from the spec (paste real lines; shorten texts):
  - `claude_text_deltas` → two delta lines give `Text("{\"page\":1,")`, `Text("\"text\":\"a\"}\n")`.
  - `claude_auth_error_is_failed` → the recorded `result` line with `"is_error":true,"result":"Failed to authenticate: this login reached its time limit and cannot be renewed. Run \`claude auth login\` to sign in again…"` → `Failed(<that text>)`.
  - `claude_max_tokens_is_truncated`, `claude_success_is_finished`.
  - `claude_ignores_noise` → `system/init`, `api_retry`, `rate_limit_event`, `assistant`, `"not json"` → `None`.
  - `codex_message_and_completion` → `agent_message` → `Text(..ends with "\n")`; `turn.completed` → `Finished { truncated: false }`.
  - `codex_startup_error_item_is_ignored` → the recorded "Code Mode is unavailable…" item → `None`.
  - `codex_turn_failed` → `{"type":"turn.failed","error":{"message":"usage limit reached"}}` → `Failed("usage limit reached")`.
  - LineSplitter tests from the API-key branch.
- [ ] **Step 2:** `cargo test ai::events` → FAIL.
- [ ] **Step 3:** Implement with `serde_json::Value`.
- [ ] **Step 4:** `cargo test ai::events` → PASS.
- [ ] **Step 5:** Commit `feat: parse the Claude and Codex JSON event streams`.

### Task 3: Finding the executable and its version (Rust)

**Files:**
- Create: `src-tauri/src/ai/discover.rs`

**Interfaces:**
- Consumes: `CliKind`.
- Produces:
  - `pub struct Program { pub exe: PathBuf, pub prefix_args: Vec<String> }` — what to spawn; for an npm `.cmd` shim `exe` = `node.exe` next to the shim (else `node` found on PATH) and `prefix_args = [<script.js absolute path>]`; for an `.exe`, `prefix_args` empty.
  - `pub fn find(kind: CliKind, custom: &str, path_var: Option<&OsStr>, home: Option<&Path>, appdata: Option<&Path>) -> Option<Program>` (pure inputs for tests; base names `claude` / `codex`, extensions `.exe`, `.cmd`; search order: `custom` if non-empty, `PATH` entries, `home\.local\bin`, `appdata\npm`).
  - `pub fn find_default(kind, custom) -> Option<Program>` (reads the real env).
  - `pub fn shim_script(cmd_text: &str, shim_dir: &Path) -> Option<PathBuf>`: extracts `"%dp0%\<rel>.js"` (also `%~dp0`) from npm shim text.
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct CliInfo { pub found: bool, pub path: Option<String>, pub version: Option<String> }`
  - `pub fn parse_version(stdout: &str) -> Option<String>`: first token that starts with a digit (`"2.1.331 (Claude Code)"` → `2.1.331`, `"codex-cli 0.172.0"` → `0.172.0`).

- [ ] **Step 1: Write failing tests:** `finds_exe_on_path` (temp dir with empty `claude.exe`), `finds_in_local_bin_without_path` (path_var `None`, home has `.local\bin\claude.exe`), `finds_npm_shim_in_appdata` (`appdata\npm\codex.cmd` with the real npm shim text from the spec machine plus `node_modules\@openai\codex\bin\codex.js`, and a `node.exe` next to it → `Program { exe: …\node.exe, prefix_args: [...codex.js] }`), `custom_path_wins`, `missing_is_none`, `shim_script_parses_npm_shim`, `parses_versions`.
- [ ] **Step 2:** `cargo test ai::discover` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test ai::discover` → PASS.
- [ ] **Step 5:** Commit `feat: find the Claude and Codex CLIs, including npm shims`.

### Task 4: Running a generation, cancel, commands (Rust)

**Files:**
- Create: `src-tauri/src/ai/run.rs`
- Modify: `src-tauri/src/ai/mod.rs` (commands), `src-tauri/src/lib.rs` (`.manage(ai::CliRuns::default())`, register `ai_cli_info`, `ai_cli_models`, `ai_cli_generate`, `ai_cli_cancel`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `#[derive(Serialize)] #[serde(rename_all = "lowercase")] pub enum Outcome { Done, Truncated, Cancelled }`
  - `pub fn run_streaming(program: &Program, args: &[String], removals: &[String], stdin: &str, kind: CliKind, cancel: &CancelToken, on_line: impl FnMut(String)) -> Result<Outcome, AppError>` — blocking; called inside `tauri::async_runtime::spawn_blocking`.
  - `#[derive(Default, Clone)] pub struct CancelToken` (holds `Arc<Mutex<Option<u32 /*pid*/>>>` + cancelled flag): `cancel()` sets the flag and runs `taskkill /T /F /PID <pid>` (with `CREATE_NO_WINDOW`); a cancel before spawn is remembered (spawn checks the flag and returns `Cancelled`).
  - `#[derive(Default)] pub struct CliRuns(Mutex<HashMap<u32, CancelToken>>)`
  - Commands: `ai_cli_info(cli: CliKind, custom_path: String) -> CliInfo` (runs `--version` with a 10 s limit); `ai_cli_generate(runs, request_id: u32, config: CliConfig, system: String, user: String, on_line: Channel<String>) -> Result<Outcome, AppError>`; `ai_cli_cancel(runs, request_id: u32)`.
- Behaviour of `run_streaming`: temp dir per run (remove after, ignore errors); write stdin then close it; read stdout lines on this thread, feed `parse_line` → `Text` into `LineSplitter` → `on_line` per complete line; `Finished` → flush splitter, return `Done`/`Truncated`; `Failed(m)` → `Err(AiCli(m))`; a reader thread for stderr keeps the last 4 KB. Silence timeout: a watchdog thread kills the tree if no stdout line for `kind.silence_timeout()` → `Err(AiCli("<name> stopped responding."))`. EOF without `Finished`: cancelled flag → `Cancelled`; else non-zero exit → `Err(AiCli(<last non-empty stderr line>, or "<name> exited with code N.">))`. Not found → `Err(AiCli("<name> was not found. Install it, or set its path in Settings → AI."))`.

- [ ] **Step 1: Write failing tests** (`#[cfg(all(test, windows))]`), using a fake CLI: `Program { exe: "cmd.exe", prefix_args: ["/C", "type", <fixture.jsonl>] }` with fixtures written to a temp dir in the test:
  - `streams_claude_lines` → fixture of Claude delta lines + success result → `on_line` gets `{"page":1,"text":"a"}`, `{"page":2,"text":"b"}`; `Ok(Done)`.
  - `claude_error_result_becomes_message` → `Err(AppError::AiCli(m))` with `m` starting "Failed to authenticate".
  - `codex_message_lines` → `agent_message` with two JSON lines + `turn.completed` → two lines, `Ok(Done)`.
  - `exit_without_result_reports_stderr` → `cmd /C "echo boom 1>&2 & exit 3"` → `Err(AiCli("boom"))`.
  - `cancel_kills_the_process_tree` → `cmd /C "powershell -NoProfile -Command Start-Sleep 30"`; cancel from another thread after 500 ms → returns `Ok(Cancelled)` within 5 s, and no `powershell` child with that parent remains (check via `tasklist /FI "PID eq <child>"` or `wmic`-free: record the child PID with PowerShell `$PID > file` first).
  - `cancel_before_spawn_is_cancelled`.
- [ ] **Step 2:** `cargo test ai::run` → FAIL.
- [ ] **Step 3:** Implement `run_streaming`, `CancelToken`, `CliRuns` and the three commands (`ai_cli_generate` looks up the program via `find_default`, builds `generate_args`, `env_removals(std::env::vars())`, registers the token, runs in `spawn_blocking`, sends lines with `on_line.send` ignoring send errors, forgets the token).
- [ ] **Step 4:** `cargo test` → PASS; `cargo clippy --all-targets` clean.
- [ ] **Step 5:** Commit `feat: run the AI CLI per request with cancel and readable errors`.

### Task 5: Model lists from the CLIs (Rust)

**Files:**
- Create: `src-tauri/src/ai/models.rs`
- Modify: `src-tauri/src/ai/mod.rs` (`ai_cli_models(cli: CliKind, custom_path: String) -> Result<Vec<CliModel>, AppError>`), `src-tauri/src/lib.rs` (register)

**Interfaces:**
- Produces:
  - `#[derive(Serialize, Debug, PartialEq)] #[serde(rename_all = "camelCase")] pub struct CliModel { pub value: String, pub label: String, pub description: String, pub efforts: Vec<String>, pub is_default: bool }`
  - `pub fn parse_claude_models(line: &str, request_id: &str) -> Option<Vec<CliModel>>` — a `control_response` whose `response.request_id` equals `request_id` (check the recorded line for the exact nesting: `response.response.models`); `value`, `displayName`, `description`, `supportedEffortLevels` (empty if absent); `is_default` = `value == "default"`.
  - `pub fn parse_codex_models(line: &str) -> Option<Vec<CliModel>>` — JSON-RPC response with `id == 2`; skip `hidden`; `value` = `model`; efforts = `supportedReasoningEfforts[].reasoningEffort` without `"ultra"`; `is_default` = `isDefault`.
  - Request flow (blocking, in `spawn_blocking`, 15 s overall timeout, then kill tree): Claude writes `{"type":"control_request","request_id":"juliepdf-models","request":{"subtype":"initialize"}}\n`; Codex writes the three JSON-RPC lines from the spec (`clientInfo.name` = `"juliepdf"`, version = `env!("CARGO_PKG_VERSION")`). Read stdout lines until a parser returns `Some`. Same temp dir / env / no-window rules as Task 4 (reuse its spawn helper).
- [ ] **Step 1: Write failing tests** with the recorded responses from the spec (trimmed to 3 models each): Claude → `default` (is_default, efforts `low..max`), `opus`, `haiku` (efforts empty); Codex → Sol (is_default), Astra, a `hidden: true` entry skipped, efforts exclude `ultra`; a line with another `request_id`/`id` → `None`; notifications → `None`.
- [ ] **Step 2:** `cargo test ai::models` → FAIL.
- [ ] **Step 3:** Implement parsers and `ai_cli_models`.
- [ ] **Step 4:** `cargo test` → PASS; clippy clean.
- [ ] **Step 5:** Commit `feat: load the model list from the Claude and Codex CLIs`.

### Task 6: Frontend IPC, preferences and the CLI generator

**Files:**
- Create: `src/ai/cliIpc.ts`, `src/ai/cliGenerator.ts`
- Modify: `src/core/settings/preferences.ts`
- Test: `tests/ai/cliGenerator.test.ts`, `tests/core/settings/preferences.test.ts`

**Interfaces:**
- Produces:
  - `cliIpc.ts`: `type CliKind = 'claude' | 'codex'`; `interface CliConfig { cli: CliKind; path: string; model: string; effort: string }`; `interface CliInfo { found: boolean; path: string | null; version: string | null }`; `interface CliModel { value: string; label: string; description: string; efforts: string[]; isDefault: boolean }`; `cliInfo(cli, customPath): Promise<CliInfo>`; `cliModels(cli, customPath): Promise<CliModel[]>`; `cliGenerate(requestId: number, config: CliConfig, system: string, user: string, onLine: (l: string) => void): Promise<'done' | 'truncated' | 'cancelled'>`; `cliCancel(requestId: number): Promise<void>` (invoke names from Task 4/5; `Channel` as in the API-key branch's `src/ai/ipc.ts`).
  - `preferences.ts`: helper `text(fallback, max = 500)` (from the API-key branch) and entries `aiEnabled: flag(false)`, `aiCli: oneOf(['claude','codex'], 'claude')`, `aiClaudeModel: text('opus', 200)`, `aiClaudeEffort: text('medium', 20)`, `aiCodexModel: text('', 200)`, `aiCodexEffort: text('medium', 20)`, `aiClaudePath: text('')`, `aiCodexPath: text('')`.
  - `cliGenerator.ts`: `export function cliConfigOf(p: Preferences): CliConfig`; `export const CODEX_LIMITS: ChunkLimits = { ...DEFAULT_LIMITS, maxPages: 20 }`; `export function limitsFor(cli: CliKind): ChunkLimits`; `export function cliGenerator(config: CliConfig, deps?: { generate?: typeof cliGenerate; cancel?: typeof cliCancel }): ExplanationGenerator` with `model` = `claude-code:<model or 'default'>` / `codex:<model or 'default'>`; a module counter gives request ids; on `signal` abort calls `cancel(id)` once; an already-aborted signal resolves `'cancelled'` without calling `generate`. Codex only: when a request rejects with a message matching `/overloaded|429|503|529|try again/i` and no line was delivered yet, wait 5 s (abortable) and retry once with a new id (Claude's CLI retries internally, so no retry for Claude).
- [ ] **Step 1: Write failing tests:**
  - preferences: defaults are exactly the Global Constraints values; `aiCli: 'gemini'` falls back to `'claude'`.
  - `cliConfigOf` picks the Claude or Codex fields by `aiCli`.
  - `limitsFor('codex').maxPages === 20`, `limitsFor('claude') === DEFAULT_LIMITS`.
  - generator forwards lines from a fake `generate` and returns its outcome; `model` is `'claude-code:opus'`; abort during generate calls fake `cancel` with the same id; a rejected `{ code: 'AiCli', message: 'Run claude auth login' }` rejects with that object (so `describeError` shows the message); Codex `overloaded` rejection before any line → retried once (fake timers) and succeeds; the same rejection for Claude is not retried; a Codex overload after a line was delivered is not retried.
- [ ] **Step 2:** `npx vitest run tests/ai/cliGenerator.test.ts tests/core/settings/preferences.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; `npm run check` clean.
- [ ] **Step 5:** Commit `feat: CLI explanation generator and AI preferences`.

### Task 7: Generate button in the status bar

**Files:**
- Create: `src/ui/ConfirmDialog.svelte` (copy from `feat/ai-explanations-apikey`), `src/ai/AiControls.svelte` (adapted from that branch), `src/ai/startGeneration.ts`
- Modify: `src/app/StatusBar.svelte`, `src/App.svelte` (`<ConfirmDialog />` next to `<ConfirmClose />`), `src/ai/runs.svelte.ts` (optional `note: string | null` on `GenerationRun`, default `null`)
- Test: `tests/app/StatusBar.test.ts`, `tests/ai/startGeneration.test.ts`

**Interfaces:**
- Consumes: `cliConfigOf`, `cliGenerator`, `limitsFor` (Task 6); `generateExplanations(session, generator, { pages, limits })`, `generationAction`, `generationRuns` (main).
- Produces:
  - `startGeneration(session, config: CliConfig, deps: { confirm(message, label): Promise<boolean> }): Promise<void>` and `retryGeneration(session, config): Promise<void>` — same flow as the API-key branch minus backup; `run` does `Promise.all([import('./generate'), import('./cliGenerator')])` and passes `limits: limitsFor(config.cli)`.
  - `AiControls.svelte` props `{ session, config: CliConfig, confirm }`; while `status === 'running' && done === 0` shows `Starting Claude…` / `Starting Codex…`; button tooltip `"<label> with <Claude Code|Codex CLI>, <model or 'default model'> (AI, Beta): the document's text is sent to the provider"`; no backup anywhere.
  - StatusBar shows `AiControls` when `session && aiEnabled && !builderOpen`, with `config={cliConfigOf(settings.data.preferences)}` and `confirm={confirmAction}`.
- [ ] **Step 1: Write failing tests:** the four StatusBar tests from the API-key branch diff (no controls when off; "Add explanations" then "Regenerate explanations"; hidden in the Builder; toggle tests kept) plus `shows "Starting Claude…" before the first page` (set `generationRuns.update(id, { status: 'running', done: 0, total: 5 })`) and `shows "Explaining 2/5" with Cancel`; startGeneration: regenerating asks first and does nothing on `false`; a run passes Codex limits (mock `./generate` with `vi.mock` and assert `limits.maxPages === 20`).
- [ ] **Step 2:** `npx vitest run tests/app/StatusBar.test.ts tests/ai/startGeneration.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; `npx vitest run` all green; `npm run check` clean.
- [ ] **Step 5:** Commit `feat: one-click explanation button in the status bar`.

### Task 8: Settings → AI (Beta)

**Files:**
- Create: `src/ai/modelOptions.ts`, `src/ai/AiSettingsPanel.svelte`
- Modify: `src/ui/SettingsDialog.svelte` (category `'ai'`, label `AI (Beta)`, icon `Sparkles`; the panel is loaded with `{#await import('../ai/AiSettingsPanel.svelte')}`)
- Test: `tests/ai/modelOptions.test.ts`, `tests/ai/AiSettingsPanel.test.ts`, `tests/ui/SettingsDialog.test.ts`

**Interfaces:**
- Consumes: `cliInfo`, `cliModels`, `cliGenerator`, `CliModel` (Tasks 5–6).
- Produces:
  - `modelOptions.ts`: `interface ModelGroups { main: CliModel[]; more: CliModel[] }`; `groupModels(models: CliModel[]): ModelGroups` — `main` = entries whose `value` has no digit (aliases: `default`, `opus`, `fable`, `sonnet`, `haiku`, `sonnet[1m]`…), `more` = the rest, CLI order kept; `withStored(groups, stored: string): ModelGroups` — appends `{ value: stored, label: stored, description: '', efforts: [], isDefault: false }` to `more` when non-empty and absent; `FALLBACK: Record<CliKind, CliModel[]>` — Claude `default`, `opus`, `sonnet`, `haiku` (efforts `['low','medium','high','max']` except haiku), Codex `[{ value: '', label: 'CLI default', … efforts ['low','medium','high','xhigh'] }]`; `effortsFor(models, value): string[]`.
  - Panel (layout as the spec's sketch): On/Off segmented (`aiEnabled`); when on: CLI segmented (`aiCli`), status line `✓ Claude Code 2.1.331 found` or `✗ Claude Code was not found` + path text field (`aiClaudePath`/`aiCodexPath`); Model `<select>` with `<optgroup label="More versions">`; Effort `<select>` (`CLI default` = `''` + levels) hidden when `effortsFor` is empty; when the list failed, a text field for the model and the note "Could not load the model list from the CLI; showing common choices."; Test button: runs `cliGenerator(config).generate({ system: SYSTEM_PROMPT, user: userPrompt([{ page: 1, text: 'Test page: the water cycle.' }], 1) }, …)` and shows `Works` when a parsable line arrived, else the error message; the disclaimer paragraph (exact copy from Global Constraints).
  - Info and models are cached in a module-level `Map<string /* cli|path */, Promise<…>>` so reopening the page in the same app session does not respawn the CLI.
- [ ] **Step 1: Write failing tests:**
  - modelOptions: grouping of the recorded Claude list (`default`, `opus`, `fable`, `sonnet`, `haiku` in main; `claude-opus-5`, `claude-sonnet-4-6` in more); `withStored` keeps a pinned value that disappeared; `effortsFor(…, 'haiku')` is empty.
  - Panel (mock `cliIpc`): off by default shows only the switch; on shows "Claude Code 2.1.331 found", model options with descriptions, effort select; selecting `haiku` hides effort; `cliModels` rejecting shows the fallback note and text field; the disclaimer text is present; Test shows `Works` with a fake generator line and the error message on rejection.
  - SettingsDialog: an `AI (Beta)` tab exists and opens its tabpanel.
- [ ] **Step 2:** `npx vitest run tests/ai tests/ui/SettingsDialog.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; full `npx vitest run`, `npm run check`, `cargo test`, `cargo clippy --all-targets` green.
- [ ] **Step 5:** Commit `feat: AI (Beta) settings with the CLI's own model list`.

### Task 9: End-to-end check in the real app

**Files:** none (fixes found here go back into the owning task's files, with a test).

- [ ] **Step 1:** In the worktree, `npm.cmd run tauri dev` from a normal terminal (not a Claude Code session; and once from one, to prove env cleaning).
- [ ] **Step 2:** Settings → AI (Beta) → On, Claude Code: version shown, model list loads (Opus 5.5 era aliases), Test shows `Works`.
- [ ] **Step 3:** Open a 20+ page lecture PDF, click "Add explanations": "Starting Claude…", then fields fill page by page; Cancel mid-run stops it (no `claude`/`node` process left in Task Manager); Retry continues; Regenerate asks first; one Ctrl+Z removes the run.
- [ ] **Step 4:** Switch to Codex CLI (model GPT-6.2-Astra): Test works; a 40-page document fills in ~20-page steps; Cancel leaves no `codex.exe`.
- [ ] **Step 5:** Set a wrong custom path → "not found" message; save the PDF and reopen it in another viewer to confirm explanations persist (#88 storage).
- [ ] **Step 6:** Report results; commit any fixes with tests (`fix: …`).
