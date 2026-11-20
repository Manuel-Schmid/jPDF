# JuliePDF: guide for contributors and coding agents

Personal Windows desktop PDF annotator (Tauri 2 + Svelte 5 + TypeScript, Rust
backend with lopdf). Annotations are saved into the PDF as standard annotations
with appearance streams, so they must look right in every other viewer. Design:
`docs/superpowers/specs/2026-11-18-juliepdf-design.md`.

This file is the shared source of instructions for every contributor and every
coding agent (Claude Code, Codex, Cursor, Copilot …). Tool-specific files such
as `CLAUDE.md` only import it and add tool-specific notes.

## Performance

Performance is a core goal: the app must stay fast, quick and responsive,
and feel lightweight. Keep work off the drawing and page-rendering paths.
If a proposed feature could noticeably slow the app or make it feel heavier,
say so (and suggest a lighter alternative) before implementing it.

## Commands

- Install: `npm ci` (a fresh clone or worktree has no `node_modules`; vitest
  cannot load another checkout's modules).
- Run the app: `npm.cmd run tauri dev` (PowerShell may block `npm.ps1`;
  `npm.cmd` works without changing the execution policy).
- TS tests: `npx vitest run` · Types: `npm run check`
- Rust tests: `cargo test` in `src-tauri/` · Lint: `cargo clippy --all-targets -- -D warnings`
- CI runs all four on every PR (`.github/workflows/ci.yml`); run them before
  opening one.

## Layout

- `src/annotations/<kind>/`: one annotation kind each (Render.svelte + an
  `AnnotationKind`: bounds, hitTest, translate, scale), registered in
  `src/annotations/index.ts`.
- `src/tools/<tool>/`: one tool each (`ToolDefinition` + handler, Options),
  registered in `src/tools/index.ts`.
- `src/core/`: session/model (annotation types, identical JSON to the Rust
  DTO), registries, viewer, geometry.
- `src-tauri/src/pdf/`: `dto.rs` (mirrors `model.ts`), `reader.rs` (PDF →
  DTO), `writer.rs` (incremental save), `appearance.rs` (appearance streams).
- A new annotation kind touches both sides: `model.ts` + `dto.rs`, a TS kind,
  reader/writer/appearance, and a roundtrip test in `src-tauri/tests/roundtrip.rs`.

## Working on a task

- Work from a GitHub issue. Assign it to yourself (or move it to *In progress*
  on the project board) before starting, so two people's agents don't build
  the same thing.
- One issue per branch and PR; the PR body says `Closes #<issue>`.
- Stay inside the issue's scope. Unrelated fixes you notice go into a new
  issue, not this PR.
- The registries (`src/annotations/index.ts`, `src/tools/index.ts`) and the
  shared model (`model.ts`, `dto.rs`) are edited by most features. Keep
  changes there minimal and rebase on `main` before opening the PR.
- Design specs worth keeping go in `docs/superpowers/specs/`. Step-by-step
  implementation plans belong in the issue or PR description, not in commits.

## Definition of done

- Tests for every feature or fix (vitest for TS, cargo tests for Rust); a new
  annotation kind also gets a roundtrip test.
- `npx vitest run`, `npm run check`, `cargo test` and
  `cargo clippy --all-targets -- -D warnings` pass.
- Anything written into a PDF was opened in at least one other viewer
  (Acrobat, Edge, browser pdf.js …) and looks the same there.
- No new npm package or crate unless the PR names it and says why: every
  dependency adds weight to a lightweight app.
- No new Tauri permissions in `src-tauri/capabilities/` unless the PR names
  them and says why.

## Conventions

- Commits are authored by the human contributor under their own git identity:
  no `Co-Authored-By` trailer or other AI attribution in commits or PRs.
- Conventional commit subjects (`feat:`, `fix:`, `test:`, `chore:` …) with a
  short body explaining what changed and why.
- Comments explain intent and edge cases; keep the existing doc-comment style.
- Formatting follows `.editorconfig` (2 spaces, LF; 4 spaces in Rust) and
  `.prettierrc` for TS/Svelte.
