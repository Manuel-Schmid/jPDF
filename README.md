# JuliePDF

A fast, lightweight PDF annotator for Windows. Highlight, draw and type notes on
your PDFs, press **Ctrl+S**, and the annotations are saved into the file as
standard PDF annotations, so they show up in every other PDF viewer too.

## How to use

### Install

1. Go to the [latest release](https://github.com/Manuel-Schmid/jPDF/releases/latest).
2. Download `JuliePDF_<version>_x64-setup.exe`.
3. Run it. No admin rights are needed; it installs for your user only.
   - The installer isn't code-signed, so Windows SmartScreen may warn you.
     Click **More info → Run anyway**.
4. Open a PDF with JuliePDF: start it from the Start menu and press **Ctrl+O**,
   or right-click a PDF → **Open with → JuliePDF**.

Requires Windows 10 or 11 (64-bit). The WebView2 runtime it uses ships with
Windows 11; on Windows 10 the installer fetches it if it's missing.

### Updates

JuliePDF checks for a new version a few seconds after it starts and asks
before installing it. Turn this off, or check by hand, in **Settings → Check
for updates**. Updates are signed; JuliePDF only installs ones built from this
repository.

### Annotate

Pick a tool from the toolbar on the right (the **+** button adds more), or use
its key:

| Key | Tool | Key | Tool |
|---|---|---|---|
| `V` | Select / move / resize | `T` | Text box |
| `M` | Marker (highlight) | `S` | Shapes |
| `P` | Pen | `L` | Lasso |
| `U` | Underline | `E` | Eraser |
| `K` | Strikethrough | | |

Select an annotation to restyle, duplicate (`Ctrl+D`), delete it (`Del`) or nudge it
with the arrow keys (1 pt; 10 pt with `Shift`).

| Shortcut | Action |
|---|---|
| `Ctrl+O` / `Ctrl+W` / `Ctrl+Tab` | Open / close / switch tab |
| `Ctrl+S` / `Ctrl+Shift+S` | Save into the PDF / Save as |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `F11` | Fullscreen |

Saving appends to the file (incremental update), so the original page content
is never rewritten.

## Building from source

Needs [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/) (plus the
[Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```powershell
npm ci
npm run tauri dev     # run in development
npm run tauri build   # installer in src-tauri/target/release/bundle/nsis/
```

Tests: `npx vitest run` (TypeScript) and `cargo test` in `src-tauri/` (Rust).

### Releasing

Releases are built, signed and published by GitHub Actions
(`.github/workflows/release.yml`); installed copies update from them.

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (a `chore: version x.y.z` PR).
2. After it's merged, tag `main` and push the tag:

   ```powershell
   git tag v1.2.3
   git push origin v1.2.3
   ```

The workflow checks that the tag matches the version, then publishes the
release with the installer, its `.sig` and `latest.json`. The release notes
(`scripts/releaseNotes.ts`) list the user-facing commits on `main` since the
previous tag and are shown in the update prompt. Preview them with
`node scripts/releaseNotes.ts v1.2.3` once the tag exists locally.

Updates are signed with a key pair: the public key is in `tauri.conf.json`
(`plugins.updater.pubkey`), the private key and its password are the
repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a backup of the private key: if
it's lost, installed copies can't update any more and have to be reinstalled
by hand once (with a new key).

Built with Tauri 2, Svelte 5 and TypeScript, pdf.js for rendering, and Rust
with `lopdf` for writing annotations.
