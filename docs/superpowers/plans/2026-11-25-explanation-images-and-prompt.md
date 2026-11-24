# Page Pictures and Better Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explanations that explain concepts, answer questions and read diagrams: a rewritten shared prompt, the whole document's text as context in every request, and pictures of the original pages (where useful by default, every page as an option) sent to Claude Code and Codex.

**Architecture:** The frontend reads all page texts, decides per page from pdf.js operator lists whether it needs a picture, cuts chunks (picture caps), renders each chunk's pictures with pdf.js (no annotations) right before sending, and passes them with the request. Rust sends them to Claude as image blocks in a `stream-json` input message and to Codex as `--image=` files in the run's temp folder.

**Tech Stack:** Svelte 5, TypeScript, pdf.js (`getOperatorList`, `render`, `OffscreenCanvas`), Rust (std, serde_json, base64 crate already present), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-25-explanation-images-and-prompt-design.md` (binding; read it first — the exact prompt text, user-message wording, selection rules and chunk rule are there and are not repeated here).

## Global Constraints

- Worktree `C:\Users\manys\projects\juliepdf-99`, branch `feat/explanation-images` (stacked on `feat/99-cli-explanations`). `node_modules` is present.
- No new crate or npm package (`base64` is already a Rust dependency).
- Nothing new runs at startup or on the drawing/rendering paths; picture code (`src/ai/pictures/*`) is loaded only by the lazily imported generation code.
- Pictures: from `session.doc` with `annotationMode: AnnotationMode.DISABLE`; page rotation as shown to the user; long edge 1280 px; JPEG quality 0.8; `media_type` `"image/jpeg"`.
- Selection thresholds: little text `< 200` characters after `cleanPageText`; image coverage `>= 0.08` of the page area; diagram `>= 25` filled/stroked `constructPath` ops; empty page = no text, no image, `< 3` filled/stroked paths.
- Chunk caps: Claude 150 pages / 40 pictured pages per request; Codex 20 pages per request. Context: all page texts if total `<= 400_000` characters, else pages within ±40 of the chunk.
- Rust safety limits: more than 60 pictures or more than 40 MB of decoded picture data → `AiCli("Too many page pictures in one request.")`.
- Claude generation adds `--input-format stream-json` and keeps every #99 lockdown flag; Codex adds one `--image=page-<n>.jpg` argument per picture (relative to the run's temp dir, which is the CLI's cwd) before the trailing `-`.
- Preference `aiPictures: oneOf(['useful', 'all'], 'useful')`. Settings copy (exact): label `Page pictures`, options `Where useful` / `Every page`, hint `Pictures help with diagrams, screenshots and scanned pages, and use more of your plan.`; Codex model without pictures: `This model can't read pictures; only page text is sent.`
- Commits: conventional subjects, short body, the user's git identity only, **no Co-Authored-By or other Claude attribution**. Comments explain intent in the existing doc-comment style. Every task has tests (vitest / cargo).

## Review Focus

1. A deck whose pictured pages are bunched (e.g. 60 diagram slides in a row) must still respect the 40-picture cap for Claude → Task 3 test `bunched pictures cut greedily at the cap`.
2. Retry with a scattered page set must still send all page texts as context and word pages as a list → Task 5 test `retry sends full context and lists scattered pages`.
3. A rotated page must be pictured upright as the user sees it, never with the user's annotations → Task 2 tests `applies the page rotation` and `renders without annotations`.
4. Cancel during "Preparing pages" or while a chunk's pictures render must stop without sending a request → Task 5 test `cancel while preparing sends nothing`.
5. A Codex model that can't read pictures must get text only (no `--image` args) → Task 7 test `codex model without image input sends no pictures`.

---

### Task 1: New prompt and user message

**Files:**
- Modify: `src/ai/prompt.ts`
- Test: `tests/ai/prompt.test.ts` (create; move existing prompt assertions from `tests/ai/logic.test.ts` if any, keep them passing)

**Interfaces:**
- Produces:
  - `SYSTEM_PROMPT: string` — the exact text from the spec section "The new prompt".
  - `type PictureNote = 'claude' | 'codex'`
  - `interface PromptInput { explain: readonly PageText[]; context: readonly PageText[] | null; total: number; pictures: readonly number[]; note: PictureNote }` — `explain`: pages to explain (text may be `''` for a pictured page without text); `context`: page texts sent for context when the request does not cover the whole document (null when `explain` is the whole document); `pictures`: page numbers with a picture in this request, ascending.
  - `function userPrompt(input: PromptInput): string` — wording exactly as the spec section "The user message" (range `pages 12–40` when contiguous, list `pages 5, 17, 18, 40` otherwise; `(no text; see its picture)` for pictured pages without text; Claude sentence `Pictures of pages a, b, c are attached.`; Codex sentence `The attached pictures show pages a, b, c, in this order.`; no picture sentence when `pictures` is empty).
  - `function pageRanges(pages: readonly number[]): string` helper (exported for tests).
- [ ] **Step 1: Write failing tests:** `system prompt has the study rules` (contains `Never begin with "This slide"`, `model answer`, `animation step`, `short concrete example`, `Plain text only`, `{"page": <page number>, "text": "<explanation>"}`); `whole document, no pictures` (starts `Explain all 3 pages of this document (one JSON line per page: 3 lines).`, no `attached`); `whole document with pictures, claude` (contains `Pictures of pages 2, 3 are attached.`); `codex picture sentence` (contains `The attached pictures show pages 2, 3, in this order.`); `chunk carries full context` (starts `Document text (all 10 pages, for context):`, contains `=== Page 10 ===`, then `Explain pages 4–6 of this document (one JSON line per page: 3 lines).`); `retry lists scattered pages` (`Explain pages 5, 17, 18, 40`); `pictured page without text` (contains `=== Page 7 ===\n(no text; see its picture)`); `pageRanges` (`[4,5,6]`→`4–6`, `[5,17,18,40]`→`5, 17, 18, 40`).
- [ ] **Step 2:** `npx vitest run tests/ai/prompt.test.ts` → FAIL.
- [ ] **Step 3:** Implement in `src/ai/prompt.ts` (keep `cleanPageText`, `MAX_PAGE_CHARS`, `PageText`). Update the one existing caller in `src/ai/generate.ts` minimally so the build stays green (`explain: chunk, context: null, total, pictures: [], note: 'claude'`); Task 5 rewires it.
- [ ] **Step 4:** `npx vitest run` and `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat: study-focused explanation prompt with document context`.

### Task 2: Picture selection and rendering

**Files:**
- Create: `src/ai/pictures/select.ts`, `src/ai/pictures/render.ts`
- Test: `tests/ai/pictures/select.test.ts`, `tests/ai/pictures/render.test.ts`

**Interfaces:**
- Produces:
  - `select.ts`: constants `LITTLE_TEXT = 200`, `IMAGE_COVERAGE = 0.08`, `DIAGRAM_PATHS = 25`, `EMPTY_PATHS = 3`; `interface PageShape { imageCoverage: number; paths: number }` (largest single image's share of the page area, 0–1; filled/stroked path count); `function analyzeOperators(fnArray: readonly number[], argsArray: readonly unknown[], ops: Record<string, number>, pageWidth: number, pageHeight: number): PageShape` — tracks the CTM through `save`/`restore`/`transform`/`paintFormXObjectBegin` (its matrix arg); image ops `paintImageXObject`, `paintInlineImageXObject`, `paintImageMaskXObject`, `paintImageXObjectRepeat`, `paintInlineImageXObjectGroup`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintSolidColorImageMask` take the area of the unit square under the CTM (`|a·d − b·c|`) / page area; a `constructPath` counts when followed (before the next `constructPath`) by a fill/stroke op (`fill`, `eoFill`, `stroke`, `fillStroke`, `eoFillStroke`, `closeStroke`, `closeFillStroke`, `closeEOFillStroke`). Recent pdf.js versions may report the paint op inside `constructPath`'s args — handle both (check the installed pdf.js version's `OPS` and `constructPath` args shape and test against it).
  - `type PageKind = 'empty' | 'text' | 'picture'`; `function classifyPage(mode: 'useful' | 'all', textLength: number, shape: PageShape): PageKind` — empty: `textLength === 0 && shape.imageCoverage === 0 && shape.paths < EMPTY_PATHS`; `'all'` → every non-empty page is `'picture'`; `'useful'` → `'picture'` when `textLength < LITTLE_TEXT || imageCoverage >= IMAGE_COVERAGE || paths >= DIAGRAM_PATHS`, else `'text'`.
  - `function pageShape(page: PDFPageProxy): Promise<PageShape>` (calls `getOperatorList()`, then `analyzeOperators` with the unrotated viewport size).
  - `render.ts`: `interface PagePicture { page: number; mediaType: 'image/jpeg'; data: string /* base64 */ }`; `function renderPicture(doc: PdfDoc, entry: PageEntry, page: number): Promise<PagePicture>` — `entry` must be a source entry; rotation = page's own rotation + `entry.rotation`; long edge 1280 px; `AnnotationMode.DISABLE`; `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })`; base64 via `FileReader`/`btoa` on the bytes; `page.cleanup()` afterwards (unless the doc is destroyed).
- [ ] **Step 1: Write failing tests:**
  - select: `small logo stays below coverage` (image under a scale transform of 5 % → coverage 0.05 → `'text'` for a 500-char page); `large image counts` (scale giving 30 % → `'picture'`); `nested transforms and form xobject matrix multiply` (save, transform(2,0,0,2), paintFormXObjectBegin with matrix scale 0.5, image → coverage of the product); `restore pops the transform`; `many filled paths are a diagram` (25 → `'picture'`, 24 → `'text'`); `unfilled paths don't count`; `little text gets a picture` (199 chars → `'picture'`, 200 → `'text'`); `empty page` (0 chars, no image, 2 paths → `'empty'` in both modes); `all mode pictures every non-empty page`.
  - render: with a mocked pdf.js page/doc: `renders without annotations` (render called with `annotationMode: AnnotationMode.DISABLE`); `applies the page rotation` (page rotate 90 + entry rotation 90 → `getViewport({ rotation: 180, … })`); `long edge is 1280` (viewport scaled so max(width,height) = 1280); `encodes jpeg 0.8` (`convertToBlob` called with `{ type: 'image/jpeg', quality: 0.8 }`, result `mediaType 'image/jpeg'`, base64 of the blob bytes); `cleans up the page`.
- [ ] **Step 2:** `npx vitest run tests/ai/pictures` → FAIL.
- [ ] **Step 3:** Implement. Use `OPS` from `pdfjs-dist` (as other code imports it) and the existing `PdfDoc` / `PageEntry` types.
- [ ] **Step 4:** `npx vitest run tests/ai/pictures` → PASS; `npm run check` clean.
- [ ] **Step 5:** Commit `feat: decide and render page pictures for explanations`.

### Task 3: Chunking with picture caps and context window

**Files:**
- Modify: `src/ai/chunking.ts`, `src/ai/cliGenerator.ts` (limits)
- Test: `tests/ai/logic.test.ts` (existing chunking tests) or `tests/ai/chunking.test.ts`

**Interfaces:**
- Produces:
  - `ChunkLimits` gains `maxPictures: number`. `DEFAULT_LIMITS.maxPictures = 40`; `CODEX_LIMITS = { ...DEFAULT_LIMITS, maxPages: 20, maxPictures: 20 }`.
  - `interface PlannedPage { page: number; text: string; picture: boolean }`
  - `function chunkPlanned(pages: readonly PlannedPage[], limits?: ChunkLimits): PlannedPage[][]` — the spec's chunk rule: smallest n with even page-count parts each within `maxPages`, `maxPictures`, and the existing token/char rules; if no even split satisfies the picture cap, cut greedily in order at the caps. Keep `chunkPages` as a thin wrapper (or remove it if nothing else uses it).
  - `function contextFor(all: readonly PageText[], chunk: readonly PlannedPage[], maxInputChars: number, window = 40): readonly PageText[] | null` — `null` when `chunk` covers all pages of `all`; all of `all` when total text ≤ `maxInputChars`; otherwise pages within ±`window` of the chunk's first/last page.
- [ ] **Step 1: Write failing tests:** `56 text pages stay one chunk`; `56 pictured pages split into two chunks of 28` (Claude); `30 pictured among 150 stay one chunk`; `bunched pictures cut greedily at the cap` (60 pictured pages then 60 text pages → no chunk has > 40 pictures, order kept, every page once); `codex 45 pages → 15/15/15`; `context null for whole-document chunk`; `context is all pages when small`; `context window ±40 when text is huge` (maxInputChars small).
- [ ] **Step 2:** Run the chunking tests → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat: chunk explanations by picture count with document context`.

### Task 4: Rust — pictures to Claude and Codex

**Files:**
- Modify: `src-tauri/src/ai/args.rs`, `src-tauri/src/ai/run.rs`, `src-tauri/src/ai/mod.rs`
- Create: `src-tauri/src/ai/pictures.rs` (`pub mod pictures;` in mod.rs)
- Test: unit tests in those files

**Interfaces:**
- Produces:
  - `pictures.rs`: `#[derive(Deserialize)] #[serde(rename_all = "camelCase")] pub struct PageImage { pub page: u32, pub media_type: String, pub data: String }`; `pub const MAX_PICTURES: usize = 60; pub const MAX_PICTURE_BYTES: usize = 40 * 1024 * 1024;` `pub fn decode_all(images: &[PageImage]) -> Result<Vec<(u32, Vec<u8>)>, AppError>` (base64 decode; limits → `AiCli("Too many page pictures in one request.")`; bad base64 → `AiCli("A page picture could not be read.")`); `pub fn file_name(page: u32) -> String` (`page-<n>.jpg`); `pub fn claude_input(user: &str, images: &[PageImage]) -> String` — one JSON line `{"type":"user","message":{"role":"user","content":[{"type":"text","text":user}, then per image {"type":"text","text":"Picture of page <n>:"}, {"type":"image","source":{"type":"base64","media_type":<media_type>,"data":<data>}}]}}` plus `\n`.
  - `args.rs`: `generate_args(cfg, system, pictures: &[u32])` — Claude: add `--input-format`, `stream-json` (all existing lockdown flags unchanged); Codex: one `--image=page-<n>.jpg` per page before the final `-`.
  - `run.rs`: `spawn_cli` / `spawn_with_stderr` / `run_streaming` gain `files: &[(String, Vec<u8>)]` written into the fresh temp dir before the child starts (names must be plain file names: reject any containing `/`, `\` or `..`). Existing callers pass `&[]`.
  - `mod.rs`: `ai_cli_generate(…, images: Vec<PageImage>, on_line)` — Claude: stdin = `claude_input(&user, &images)`, no files; Codex: stdin = `user`, files = decoded pictures named `file_name(page)`.
  - Keep the app working between tasks: `src/ai/cliIpc.ts` `cliGenerate` sends `images: []` in its invoke args for now (Task 7 passes real pictures); update its test.
- [ ] **Step 1: Write failing tests:** `claude_input_shape` (parse the line with serde_json: `type == "user"`, content[0] is the text, content[1] `Picture of page 3:`, content[2] image with `media_type` `image/jpeg` and the data); `claude_args_keep_lockdown_with_stream_input` (existing lockdown pairs + `--input-format stream-json`); `codex_image_args_before_stdin_dash` (`--image=page-2.jpg`, `--image=page-5.jpg`, last arg `-`); `no_pictures_no_image_args`; `too_many_pictures_rejected` (61); `oversized_pictures_rejected`; `bad_base64_rejected`; `files_written_into_temp_dir_and_removed` (spawn a fake `cmd /C dir` listing → output contains `page-2.jpg`; dir gone afterwards); `file_names_must_be_plain` (`../x` rejected).
- [ ] **Step 2:** `cargo test ai::` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` + `cargo clippy --all-targets` → PASS / clean.
- [ ] **Step 5:** Commit `feat: send page pictures to Claude Code and Codex`.

### Task 5: Generation flow with preparing phase and pictures

**Files:**
- Modify: `src/ai/generate.ts`, `src/ai/generator.ts`, `src/ai/runs.svelte.ts`, `src/ai/AiControls.svelte` (status text)
- Test: `tests/ai/generate.test.ts`, `tests/app/StatusBar.test.ts`

**Interfaces:**
- Consumes: Task 1 `userPrompt`/`PromptInput`, Task 2 `pageShape`/`classifyPage`/`renderPicture`/`PagePicture`, Task 3 `chunkPlanned`/`contextFor`/`PlannedPage`.
- Produces:
  - `GenerationRequest` gains `images: readonly PagePicture[]`.
  - `ExplanationGenerator` gains `readonly pictureNote: PictureNote` and `readonly pictures: boolean` (false → never render pictures; pages still classified so empty pages are skipped). Add them to `cliGenerator` right away (`pictureNote` from `config.cli`, `pictures: true`) so it compiles; Task 7 makes `pictures` configurable and forwards `request.images`.
  - `GenerateOptions` gains `pictures?: 'useful' | 'all'` (default `'useful'`).
  - `GenerationRun.status` gains `'preparing'`; progress fields reused (`done`/`total` count prepared pages during `'preparing'`).
  - Flow (spec "Requests and chunking"): read texts of **all** pages (context) and shapes of the pages to explain → classify → `noTextPages` = empty pages only (full run replaces, retry adds) → `chunkPlanned` → per chunk: render its pictures (if `generator.pictures`), build `userPrompt` with `contextFor(...)` and `note: generator.pictureNote`, call `generator.generate({ system, user, images })`. Pictures of chunk k+1 may be rendered while chunk k runs; drop each chunk's pictures after it is sent. Abort checks before each render and before each send.
  - AiControls: `'preparing'` shows `Preparing pages {done}/{total}`.
- [ ] **Step 1: Write failing tests** (fake session/doc/generator as existing generate tests do; mock `./pictures/select` and `./pictures/render`): `scanned page is explained from its picture` (0 chars + picture → request has its image, prompt has `(no text; see its picture)`, not in noTextPages); `empty page keeps the no-text note and is not sent`; `pictures only for the chunk's pages`; `generator without picture support renders nothing`; `retry sends full context and lists scattered pages`; `cancel while preparing sends nothing`; `cancel while rendering a chunk sends nothing more`; `preparing status counts pages`; StatusBar: `shows Preparing pages 3/10`.
- [ ] **Step 2:** `npx vitest run tests/ai/generate.test.ts tests/app/StatusBar.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full `npx vitest run` + `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat: prepare pages and send pictures during explanation runs`.

### Task 6: Picture-capable models

**Files:**
- Modify: `src-tauri/src/ai/models.rs`, `src/ai/cliIpc.ts`, `src/ai/modelOptions.ts`
- Test: models.rs unit tests, `tests/ai/modelOptions.test.ts`

**Interfaces:**
- Produces: `CliModel` gains `images: bool` (serde `images`; TS `images: boolean`): Claude models always `true`; Codex `true` iff `inputModalities` contains `"image"` (missing field → `true`). Fallback models: `images: true`. `withStored`'s synthetic entry: `images: true`. `function picturesFor(models: CliModel[], value: string): boolean` in modelOptions.ts (unknown value → `true`).
- [ ] **Step 1: Write failing tests:** Rust `codex_models_report_image_input` (`["text","image"]` → true, `["text"]` → false, absent → true); `claude_models_read_images`; TS `picturesFor` (known text-only → false, unknown → true).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `cargo test`, `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat: know which models can read page pictures`.

### Task 7: Wiring, settings and IPC

**Files:**
- Modify: `src/core/settings/preferences.ts`, `src/ai/config.ts`, `src/ai/cliIpc.ts`, `src/ai/cliGenerator.ts`, `src/ai/startGeneration.ts`, `src/ai/AiSettingsPanel.svelte`
- Test: `tests/core/settings/preferences.test.ts`, `tests/ai/cliGenerator.test.ts`, `tests/ai/startGeneration.test.ts`, `tests/ai/AiSettingsPanel.test.ts`

**Interfaces:**
- Consumes: Task 4 command param `images`, Task 5 generator fields/options, Task 6 `picturesFor`.
- Produces:
  - Preference `aiPictures` (Global Constraints). `CliConfig` unchanged; `cliConfigOf` unchanged.
  - `cliGenerate(requestId, config, system, user, images: readonly PagePicture[], onLine)` passes `images` to `ai_cli_generate`.
  - `cliGenerator(config, deps?, opts?: { pictures?: boolean })` → `pictureNote = config.cli === 'claude' ? 'claude' : 'codex'`, `pictures = opts?.pictures ?? true`; sends `request.images` only when `pictures` is true (else `[]`).
  - `startGeneration` passes `pictures: prefs.aiPictures` to `generateExplanations` and `{ pictures: <model can read pictures> }` to `cliGenerator`. The model capability comes from the Settings panel's cached model list when available (export a small lookup from the panel's cache module, e.g. `knownPictureSupport(cli, path, model): boolean | undefined`; undefined → true) — keep it lazy (no CLI spawn on click).
  - Settings panel: `Page pictures` segmented control (copy in Global Constraints) under Effort; the Codex no-pictures note under the model when `picturesFor` is false.
- [ ] **Step 1: Write failing tests:** preferences `aiPictures defaults to useful`, invalid → `useful`; cliGenerator `passes images to the backend`, `codex model without image input sends no pictures` (pictures false → images `[]`); startGeneration `passes the pictures preference`; panel `page pictures control saves the choice`, `shows the no-pictures note for a text-only codex model`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Full `npx vitest run`, `npm run check`, `cargo test` → PASS.
- [ ] **Step 5:** Commit `feat: page pictures setting for explanations`.

### Task 8: Real-CLI check and evaluation

**Files:**
- Modify: `src-tauri/src/ai/real_cli.rs` (ignored tests)

- [ ] **Step 1:** Add `#[ignore]` tests that send one small generated JPEG/PNG picture (a page with two coloured halves and the words "Lazy evaluation") through the real `ai_cli_generate` path pieces (`generate_args` with pictures, `claude_input` / files, `run_streaming`) for Claude (haiku) and Codex (CLI default, effort low), asserting the explanation line for that page mentions the visible words or colours. Run `cargo test real_cli -- --ignored --nocapture` (uses a little of the user's plans; approved).
- [ ] **Step 2:** `npm.cmd run tauri dev` boots without errors (stop it afterwards, no stray processes).
- [ ] **Step 3:** Write the evaluation checklist into the PR description draft (`docs/superpowers/plans/2026-11-25-explanation-images-eval.md`, not shipped): the pages listed in the spec's "Evaluation" section with the old explanation text (from the analysis) and an empty "new" column, for the user's re-generation in the app.
- [ ] **Step 4:** Commit `test: real CLI picture checks and evaluation checklist`.
