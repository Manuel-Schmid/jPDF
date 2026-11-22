# JuliePDF — Design Document (MVP)

Date: 2026-11-18
Status: Draft, awaiting approval

---

## 1. Intent

JuliePDF ("jPDF") is a personal Windows desktop PDF annotator built for studying lecture slides. The core loop:

1. Open a lecture PDF (often several, as tabs).
2. Highlight text with the marker, handwrite/draw with the pen (mouse now, digital pen later), add typed notes in text boxes.
3. Press **Ctrl+S** — annotations are saved into the same file.
4. The file is kept, sent to friends or uploaded to an AI — so **annotations must look correct in every other PDF viewer**.

The goal is for JuliePDF to be the only app needed for handling PDFs. Printing maths slides into OneNote is an occasional workaround to get unlimited space to the right of and below a page for solving tasks; that need belongs in JuliePDF itself (issue #3), not in an export path to OneNote.

The inspiration is Drawboard PDF (the user's favourite) and the screenshot of a similar tool: dark chrome, slim tab bar on top, vertical tool strip on the right, document in the middle.

Above everything else the app must be **fast**, **lightweight**, **modern and sleek**, and **modular** so features can be added over time without touching the core.

## 2. Goals, non-goals, anti-goals

### Goals (MVP)
- Open, view, free-scroll and zoom PDFs; multiple PDFs as tabs.
- Right-side toolbar with tools; **"+"** button at the bottom opens a picker to add tools.
- Tools: **Select**, **Hand (pan)**, **Marker** (text-selection mode + freehand mode), **Pen**, **Text box**, **Eraser**.
- Undo/redo, edit/move/resize/recolor/delete existing annotations.
- Fullscreen mode that hides the top bar (tabs), the toolbar and the status bar.
- Save in place (Ctrl+S) as **standard PDF annotations** with appearance streams (Drawboard-style), readable/editable again by JuliePDF.
- Dark theme inspired by **Material Deep Ocean** with **Amber** accent; minimal JuliePDF branding.

### Non-goals (not in MVP, but the architecture must allow them)
- Theme customization UI (tokens are prepared for it).
- Pen pressure sensitivity, palm rejection (pen already works like a mouse via Pointer Events).
- Page management (insert/delete/reorder pages), forms, signatures, OCR, search, outline/thumbnail sidebar, flatten-on-export, cloud sync, printing from inside the app.
- Non-Windows platforms.

### Anti-goals (would make it a failure even if it "works")
- Sluggish scrolling/zooming, slow startup, or a 100+ MB install.
- Annotations that only JuliePDF can see (custom overlays, sidecar files).
- Saving that can corrupt or silently alter the original slide content.
- A cluttered, "enterprise" UI.
- A monolith where adding a tool means editing core files all over the place.

## 3. Technology decisions

| Concern | Choice | Why |
|---|---|---|
| App shell | **Tauri 2** | Uses the Edge **WebView2** already on Windows 11 → ~5–10 MB installer, low idle RAM, native Rust backend. Electron would be 100+ MB. |
| UI language/framework | **TypeScript + Svelte 5** (Vite) | Compiles away, tiny runtime, very fast reactivity; simplest way to build a sleek, themeable UI with CSS variables. |
| PDF rendering + text layer | **pdf.js** (`pdfjs-dist`, bundled locally) | Mature (Firefox's engine), renders in a Web Worker, provides the **text layer** required for text-selection highlighting. |
| PDF writing (save) & reading own annotations | **Rust + `lopdf`** | Native speed, precise control over PDF objects, lets us write **incremental updates** (append-only, original bytes untouched). |
| Settings persistence | Rust, JSON file in `%APPDATA%\JuliePDF\settings.json` | Simple, human-readable, versioned. |
| Unit tests | **Vitest** (TS), `cargo test` (Rust) | Standard for each side. |
| Packaging | Tauri bundler → **NSIS installer** (+ portable exe) | Small, supports per-user install and `.pdf` "Open with" registration. |

No CDN usage at runtime — everything (fonts, pdf.js worker, icons) is bundled so the app works fully offline.

### IDE

- **VS Code** (recommended, free): extensions *rust-analyzer*, *Svelte for VS Code*, *Tauri*, *ESLint*, *Prettier*.
- **IntelliJ IDEA works too**: IntelliJ IDEA Ultimate (free with a student licence via JetBrains Education) with the **Rust** plugin and the **Svelte** plugin. Alternatively **RustRover** (free for non-commercial use) + Svelte plugin. Run the app from the built-in terminal with `npm run tauri dev`.

Since Claude writes the code, the IDE is mainly for running the app, reading diffs and occasional browsing — pick whichever you like.

### Machine prerequisites (one-time)
1. **Microsoft C++ Build Tools** (workload "Desktop development with C++").
2. **Rust** via `rustup` (MSVC toolchain, stable).
3. **Node.js LTS** (includes npm).
4. **WebView2 Runtime** (preinstalled on Windows 11).
5. Git (recommended; project gets version control from the start).

## 4. Architecture

```
┌──────────────────────────── WebView2 (TypeScript / Svelte) ─────────────────────────────┐
│                                                                                          │
│  App Shell ── TitleBar(logo, tabs, window controls) ── StatusBar ── Fullscreen manager   │
│      │                                                                                   │
│  Document Session (one per tab)                                                          │
│   ├─ PdfEngine (pdf.js wrapper: load, render page tiles, text layer)  ← Web Worker       │
│   ├─ Viewport (virtualized continuous scroll, zoom, coordinate transforms)               │
│   ├─ AnnotationStore (annotations per page, dirty flag)                                  │
│   ├─ History (command stack: undo/redo)                                                  │
│   └─ OverlayLayer per visible page (SVG: renders annotations, receives pointer input)   │
│                                                                                          │
│  Registries (the extension points)                                                       │
│   ├─ ToolRegistry        — tool types (Select, Hand, Marker, Pen, Text, Eraser, …)       │
│   ├─ AnnotationKindRegistry — how each annotation kind renders / hit-tests / serializes  │
│   ├─ CommandRegistry     — named actions (open, save, undo, toggleFullscreen, …)         │
│   └─ KeybindingRegistry  — shortcut → command                                            │
│                                                                                          │
│  Stores: settings (persisted), toolbar layout (persisted), theme tokens (CSS variables)  │
└────────────────────────────────────── Tauri IPC ─────────────────────────────────────────┘
┌──────────────────────────────────── Rust core ───────────────────────────────────────────┐
│  commands: open_file → bytes + parsed editable annotations                               │
│            save_file(path, annotation DTOs, deleted ids) → incremental update            │
│            load_settings / save_settings                                                 │
│  pdf::reader — finds annotations, maps them to DTOs                                      │
│  pdf::writer — builds annotation dicts + appearance streams, appends incremental update  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Data flow
- **Open**: Rust reads the file → returns raw bytes (binary IPC response, not JSON/base64) **and** the list of editable annotations it recognised. pdf.js loads the bytes for rendering; the AnnotationStore is filled with the DTOs.
- **Render**: pdf.js draws page content to a canvas. Annotations that JuliePDF manages are drawn **only by the overlay**, never by pdf.js too (no double drawing). Annotations JuliePDF doesn't understand (links, stamps, other tools' exotic types) are still rendered by pdf.js, read-only. *Builder's choice of mechanism*: e.g. render with pdf.js annotation drawing disabled and draw non-managed annotations separately, or hide managed annotation ids via pdf.js render options.
- **Edit**: tools create **commands** (AddAnnotation, UpdateAnnotation, DeleteAnnotation, batch) that go through History → AnnotationStore. The tab gets a "•" unsaved marker.
- **Save** (Ctrl+S): store → DTOs → Rust writer appends an incremental update to a temp copy → atomic replace of the original. Unsaved marker clears.

### 4.2 Coordinates
All annotation geometry is stored in **PDF user space** (points, origin bottom-left, per page, respecting `/Rotate` and CropBox). The Viewport owns the transform PDF ↔ screen. This makes zoom free (no geometry changes) and saving direct.

### 4.3 Annotation model (TypeScript)

```ts
type Color = { r: number; g: number; b: number };     // 0..1

interface AnnotationBase {
  id: string;            // stable UUID, written to /NM
  kind: string;          // registry key: 'highlight' | 'ink' | 'freetext' | …
  page: number;          // 0-based
  createdAt: string; modifiedAt: string;
  sourceRef?: string;    // existing PDF object id if loaded from file
}

interface HighlightAnnotation extends AnnotationBase {    // text-selection marker
  kind: 'highlight';
  quads: number[][];     // QuadPoints, one quad per text line fragment
  color: Color; opacity: number;
}

interface InkAnnotation extends AnnotationBase {          // pen + freehand marker
  kind: 'ink';
  strokes: { x: number; y: number }[][];
  color: Color; width: number; opacity: number;
  blend: 'normal' | 'multiply';   // marker uses multiply so text stays readable
  role: 'pen' | 'marker';
}

interface FreeTextAnnotation extends AnnotationBase {     // text box
  kind: 'freetext';
  rect: [number, number, number, number];
  text: string;
  fontSize: number; textColor: Color;
  background: { color: Color; opacity: number } | null;  // null = transparent
}
```

### 4.4 Extension points

**Tool definition** — adding a tool = one folder under `src/tools/<name>/` + one registration line.

```ts
interface ToolDefinition<S> {
  type: string;                    // 'pen'
  displayName: string;             // 'Pen'
  description: string;             // shown in the "+" picker
  icon: Component<{ settings: S }>;// icon can reflect settings (e.g. colour)
  defaultSettings: S;
  OptionsPanel: Component<{ settings: S; update(patch: Partial<S>): void }>;
  cursor?: (settings: S) => string;
  allowMultipleInstances: boolean; // e.g. several pens with different colours
  createHandler(ctx: ToolContext, settings: S): ToolHandler;
}

interface ToolHandler {            // pointer input scoped to a page overlay
  onPointerDown?(e: PagePointerEvent): void;
  onPointerMove?(e: PagePointerEvent): void;
  onPointerUp?(e: PagePointerEvent): void;
  onKeyDown?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

interface ToolContext {            // the only API tools get — keeps them decoupled
  session: DocumentSession;        // store, history, viewport, text layer access
  execute(cmd: Command): void;
  select(ids: string[]): void;
  requestRender(): void;
}
```

**Annotation kind definition** (frontend) — render as SVG, hit-test, bounds, move/resize, to-DTO. A matching `AnnotationDto` variant + writer/reader exists on the Rust side (`enum AnnotationDto` with serde tag). Adding a new annotation *kind* therefore touches one TS module and one Rust module; adding a new *tool* that reuses existing kinds touches only TS.

**Commands & keybindings** — every action is a named command; menus, buttons and shortcuts all call commands. Future features (e.g. "flatten export", "search") register commands without touching the shell.

## 5. UI specification

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ jPDF │ [Lecture08.pdf •][Exercise3.pdf ×][+]          ─  ▢  ✕           │ ← title bar 40px
├─────────────────────────────────────────────────────────────────┬───────┤
│                                                                 │  ↖    │
│                     ┌─────────────────────┐                     │  ✋   │
│                     │                     │                     │  ▮ M  │ ← tool strip 52px
│                     │       page 1        │                     │  ✎ P  │
│                     │                     │                     │  T    │
│                     └─────────────────────┘                     │  ⌫    │
│                     ┌─────────────────────┐                     │       │
│                     │       page 2        │                     │       │
│                                                                 │  ＋   │
├─────────────────────────────────────────────────────────────────┴───────┤
│ ↶ ↷                       ‹  [ 3 ] / 52  ›            −  125 %  +  ⛶  │ ← status bar 32px
└─────────────────────────────────────────────────────────────────────────┘
```

- **Custom title bar** (native decorations off): logo at the left, tabs, "+" (open file), window controls (minimize / maximize / close) at the right, draggable empty area.
- **Tool strip** on the right, vertically centred list of tool *instances*, divider, **"+"** pinned at the bottom.
- **Tool options flyout**: clicking the already-active tool (or right-click) opens a flyout panel to the left of the strip with that tool's options. Closes on outside click / Esc.
- **Status bar**: undo/redo, page navigation (prev, editable page number, total, next), zoom out / zoom % (click to type) / zoom in, fullscreen button.
- **Empty state** (no PDF open): centred large logo, "Open PDF" button, hint "or drop a file here · Ctrl+O".

### 5.2 Toolbar & "+" picker
- The toolbar holds **tool instances**, each with its own settings — e.g. a yellow marker and a green marker, a black pen and a red pen (like the screenshot). Icons show the instance's colour.
- **"+"** opens a modal picker (dim backdrop, card grid): icon, name, one-line description for each registered tool type. Clicking adds a new instance with default settings to the end of the strip.
- Right-click an instance → *Options*, *Duplicate*, *Remove*. Drag to reorder.
- Toolbar layout + per-instance settings persist across restarts.
- **Default toolbar**: Select, Hand, Marker (yellow, text mode), Pen (red), Text box, Eraser.

### 5.3 Tools

| Tool | Behaviour | Options |
|---|---|---|
| **Select** (default) | Click an annotation to select (handles + bounding box); drag to move; handles to resize (text boxes: width; ink: scale); Delete key removes; options of the selected annotation are editable in the flyout (colour, opacity, etc.). Drag on page text selects text → Ctrl+C copies. Double-click a text box to edit its text. | — |
| **Hand** | Drag to pan. Also available temporarily by holding **Space** or middle mouse button in any tool. | — |
| **Marker** | **Mode: Text** (default) — drag across text to select it; on release the selection becomes a Highlight annotation (one quad per line). If the page has no text layer (scanned slides), automatically behaves as freehand and shows a small one-time hint. **Mode: Freehand** — drag to draw a translucent stroke (multiply blend); hold **Shift** for a straight line. | Mode (Text / Freehand), colour (6 presets + custom picker), opacity (10–100 %), thickness (freehand only, 4–40 pt) |
| **Pen** | Draw freehand ink with light smoothing and point simplification. Pointer Events → mouse and digital pen both work (no pressure in MVP). | Colour (presets + custom), thickness (0.5–20 pt), opacity (10–100 %) |
| **Text box** | Click on a page to create a box and start typing; box grows with content; click outside to finish. Empty boxes are discarded. | Text colour, font size (8–72 pt), background: transparent / colour + opacity (0–100 %) |
| **Eraser** | Drag over annotations; any ink or highlight annotation touched is deleted (whole-object eraser). Text boxes are removed with Select + Delete. | — |

Each instance remembers its last settings.

### 5.4 Navigation & view
- Continuous vertical scroll through all pages, pages centred with small gaps; free scrolling with wheel/touchpad/scrollbar.
- Zoom: **Ctrl + wheel** (anchored at cursor), touchpad pinch, **Ctrl + / Ctrl − / Ctrl 0** (fit width). Range 10 %–800 %. Default on open: fit width.
- While zooming, the current bitmap is CSS-scaled immediately; crisp re-render happens shortly after zooming stops.
- Page number input jumps to a page.

### 5.5 Fullscreen
- **F11** or status-bar button toggles. Hides title bar/tabs, tool strip and status bar; the document fills the screen; Windows fullscreen (no taskbar).
- **Esc** or F11 exits. Tool shortcuts keep working in fullscreen, and the active tool keeps working.
- *My call:* no hover-to-reveal in MVP (can be added later as a setting).

### 5.6 Keyboard shortcuts (MVP)
Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+W close tab · Ctrl+Tab / Ctrl+Shift+Tab switch tab · Ctrl+Z undo · Ctrl+Y / Ctrl+Shift+Z redo · Delete remove selection · Esc deselect / close flyout / exit fullscreen · F11 fullscreen · Ctrl+wheel / Ctrl+± / Ctrl+0 zoom · Space (hold) pan · V select · H hand · M marker · P pen · T text · E eraser (letter shortcuts pick the first instance of that tool type; pressing again cycles instances).

### 5.7 Tabs & files
- Multiple PDFs as tabs; "•" marks unsaved changes; closing a dirty tab or the app asks *Save / Don't save / Cancel*.
- Open via Ctrl+O dialog, drag-and-drop onto the window, double-click a `.pdf` if JuliePDF is set as "Open with", or command-line argument. Opening a second file while the app runs opens it as a tab in the existing window (single instance).
- If the file is locked / read-only on save → error toast with **Save As…**.
- Password-protected PDFs: MVP shows a clear message ("Encrypted PDFs are not supported yet"), doesn't crash.

## 6. Saving format (Drawboard-style)

Annotations are written as **standard PDF annotations**, each with an **appearance stream** (`/AP /N`) so every viewer (Edge, Chrome, Acrobat, Drawboard, OneNote printouts, AI uploads that render pages) draws them identically.

| JuliePDF | PDF annotation | Key details |
|---|---|---|
| Text-selection highlight | `/Subtype /Highlight` | `/QuadPoints`, `/C`, `/CA` opacity, AP drawn with `/BM /Multiply` ExtGState |
| Pen | `/Subtype /Ink` | `/InkList`, `/BS /W` width, `/C`, `/CA`, round caps/joins in AP |
| Freehand marker | `/Subtype /Ink` | same as pen, wider, AP uses `/BM /Multiply`; a private key marks it as marker so JuliePDF reopens it with the marker tool settings |
| Text box | `/Subtype /FreeText` | `/DA` (font, size, colour), `/Contents` (plain text), background via `/C` + AP fill with opacity; font Helvetica (standard 14, WinAnsi — covers German umlauts and ß) |

All annotations also get: `/NM` (JuliePDF UUID), `/M` (modified date), `/T` (author: configurable, default "JuliePDF"), `/F 4` (print flag — so they print), and a private dictionary `/JuliePDF << /v 1 … >>` holding exact settings for lossless round-trip. Other viewers ignore the private key.

**Incremental update**: new and changed annotation objects + updated page `/Annots` arrays + new xref section are appended to the end of the file. Original bytes are never rewritten → fast, and the slide content cannot be damaged. Written to a temp file, flushed, then atomically replaces the original.

**Reading**: on open, Rust parses existing annotations. JuliePDF's own annotations (with the private key) load exactly. Standard Highlight / Ink / FreeText annotations from other tools (e.g. Drawboard) are loaded as editable too, mapped as closely as possible. Anything else stays display-only and is preserved untouched on save.

*Later (non-goal now)*: "Export flattened copy" for tools that ignore annotations; embedded fonts for non-Latin text; tracking of incremental-update growth with an occasional full rewrite ("optimize file").

## 7. Visual design

### 7.1 Theme tokens (Material Deep Ocean–inspired, Amber accent)
All colours are CSS variables in one file (`src/theme/tokens.css`) — the future theme customizer simply swaps this set.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F111A` | main background / document canvas area |
| `--bg-deep` | `#090B10` | title bar, status bar, tool strip |
| `--surface` | `#1A1C25` | flyouts, modals, tabs (active) |
| `--surface-hover` | `#1F2233` | hover, selection backgrounds |
| `--border` | `#1F2233` | hairlines, dividers |
| `--text` | `#8F93A2` | standard text, icons |
| `--text-strong` | `#EEFFFF` | active tab, headings |
| `--text-muted` | `#4B526D` | hints, disabled |
| `--accent` | `#FFC107` | Amber: active tool, focus rings, logo "j", primary buttons |
| `--accent-soft` | `rgba(255,193,7,0.15)` | active tool background |
| `--danger` | `#FF5370` | destructive actions, errors |
| `--success` | `#C3E88D` | confirmations |

(Values follow the Material Deep Ocean palette as closely as known; final shades can be tuned by eye during implementation.)

### 7.2 Style
- Typography: **Segoe UI Variable** (native on Windows 11 → zero bytes, crisp ClearType), 13 px UI base.
- Radii 6–8 px, 1 px hairline borders, no heavy shadows (one soft shadow for flyouts/modals), 120–150 ms ease-out transitions; respect "reduce motion".
- Icons: **Lucide** (MIT, tree-shaken SVGs — only used icons are bundled).
- Pages sit on `--bg` with a subtle shadow; 16 px gap between pages.

### 7.3 Branding
- Name: **JuliePDF**. Logo / wordmark: **jPDF** — lowercase **"j" in Amber `#FFC107`**, **"PDF" in `--text-strong`**, Segoe UI Variable Display Semibold, slight negative letter-spacing. Shown at the left of the title bar and large in the empty state.
- App/taskbar icon: rounded square in `#0F111A` with an Amber "j" (readable at 16 px); larger sizes may show "jPDF". Generated in all required sizes via `tauri icon`.
- Window title: "<file name> — JuliePDF".

## 8. Performance budget

| Metric | Target |
|---|---|
| Installer size | < 15 MB |
| App start → window visible | < 1 s |
| Open a 50-page lecture PDF → first page visible | < 300 ms |
| Scroll / zoom | 60 fps, no blank flashes on normal scrolling |
| Pen latency | stroke follows pointer within one frame (draw live stroke on overlay, commit on pointer-up) |
| Save (typical lecture with ~100 annotations) | < 200 ms |
| Idle RAM with one PDF | < 200 MB (WebView2 baseline included) |

Techniques: page virtualization (render only visible pages ± 1–2), canvas pooling and LRU cache of rendered pages, rendering at device-pixel-ratio, pdf.js in a worker, text layer only for visible pages, `requestAnimationFrame`-batched pointer handling with coalesced events, binary IPC for file bytes, no heavy UI library.

## 9. Project structure

```
juliepdf/
  docs/superpowers/specs/          design docs
  docs/superpowers/plans/          implementation plans
  src/                             frontend (TS + Svelte)
    app/                           shell: TitleBar, Tabs, StatusBar, EmptyState, Fullscreen
    core/
      session/                     DocumentSession, AnnotationStore, History, commands
      viewer/                      PdfEngine (pdf.js), Viewport, PageView, TextLayer, Overlay
      registry/                    ToolRegistry, AnnotationKindRegistry, Command/Keybinding registries
      ipc/                         typed wrappers for Tauri commands
      settings/                    settings & toolbar-layout stores
    annotations/                   highlight/, ink/, freetext/  (render, hit-test, dto)
    tools/                         select/, hand/, marker/, pen/, text/, eraser/
    ui/                            reusable widgets: ColorPicker, Slider, Flyout, Modal, Toast
    theme/                         tokens.css, base.css
  src-tauri/                       Rust
    src/commands/                  open_file, save_file, settings
    src/pdf/reader.rs, writer.rs, appearance.rs, dto.rs
    tests/fixtures/                sample PDFs for round-trip tests
```

## 10. Implementation approach (milestones)

Each milestone ends with a runnable app and is committed. A detailed step-by-step plan (tasks, files, tests) is written after this design is approved.

1. **M0 — Environment & scaffold**: install prerequisites, `git init`, create Tauri 2 + Svelte + TS project, lint/format/test tooling, empty window runs.
2. **M1 — Shell, theme, branding**: tokens, custom title bar with window controls, logo, status bar, empty state, single-instance + drag-and-drop/open dialog wiring.
3. **M2 — Viewer**: open via Rust (binary IPC), pdf.js worker, virtualized continuous scroll, zoom (Ctrl+wheel anchored, buttons, fit width), page navigation, tabs. Performance check against budget.
4. **M3 — Annotation core**: model, AnnotationStore, History (undo/redo), overlay layer, coordinate transforms, ToolRegistry, toolbar with instances, options flyout, "+" picker, persisted toolbar layout.
5. **M4 — Pen, Hand, Eraser**: first real tools, live stroke rendering, smoothing.
6. **M5 — Save & reopen (Rust)**: incremental writer with appearance streams for Ink, reader, atomic save, dirty markers, close prompts. **Done early to de-risk the most important requirement**; verified by opening saved files in Edge, Chrome and Acrobat Reader.
7. **M6 — Marker**: freehand mode (ink + multiply), text mode (text layer, selection → quads → Highlight), auto-fallback for pages without text, Highlight writer/reader.
8. **M7 — Text box**: placing, editing, auto-grow, background options, FreeText writer/reader.
9. **M8 — Select tool**: selection, move, resize, delete, edit properties, copy text.
10. **M9 — Fullscreen & polish**: F11 mode, shortcuts table, toasts, error handling (locked/encrypted files), performance pass against budget.
11. **M10 — Packaging**: icons, NSIS installer, "Open with" registration, version info.

## 11. Testing & verification
- **Rust**: unit tests for appearance-stream generation and DTO mapping; round-trip tests (write → read → equal) on fixture PDFs; output validated with `qpdf --check`; incremental update verified to keep original bytes as an unchanged prefix.
- **TypeScript**: Vitest for History, AnnotationStore, coordinate transforms, quad building from text selection, tool registry.
- **Cross-viewer check** (manual, per milestone that touches saving): open saved files in Microsoft Edge, Chrome, Adobe Acrobat Reader, Drawboard PDF; print to OneNote.
- **Performance**: measure the budget metrics on a real 50+-page lecture PDF at M2 and M9.

## 12. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Double drawing of annotations (pdf.js + overlay) | Explicit rule in §4.1; test with a file containing both managed and foreign annotations. |
| FreeText looks different across viewers | Always write our own appearance stream; test in Edge/Acrobat/Chrome at M7. |
| Text layer quality varies per PDF (odd spacing, rotated text) | Quads built from selection client rects merged per line; freehand fallback always available. |
| Large PDFs / high zoom memory | Virtualization, LRU canvas cache, cap render resolution at very high zoom (tile later if needed). |
| Repeated incremental saves grow the file | Acceptable for MVP; "optimize file" (full rewrite) noted as follow-up. |

## 13. Decisions recorded

**Decided by the user**
- Windows desktop app, lightweight, fast, modern dark UI; customizable design later, dark mode only now.
- Toolbar on the right; "+" at the bottom opens a picker for adding tools.
- Fullscreen hides toolbar and tab bar; free scrolling; zoom.
- Tools: marker (colour, opacity; **both** text-selection and freehand modes, text mode primary), pen (colour, thickness), text box (text colour, size, background transparent/colour/opacity). Mouse first; pen can come for free.
- Ctrl+S saves into the PDF; annotations saved Drawboard-style as standard PDF annotations.
- Additions accepted for MVP: undo/redo, select/move/resize/recolor/delete, stroke eraser, tabs, unsaved markers, remembered tool settings.
- Branding: "JuliePDF", logo "jPDF". Theme inspired by Material Deep Ocean, Amber accent, background `#0F111A` (exchangeable later).
- Claude writes all code and picks the stack.

**Claude's calls (please check)**
- Stack: Tauri 2 + Svelte 5/TypeScript + pdf.js + Rust/lopdf; VS Code recommended, IntelliJ Ultimate/RustRover supported.
- Toolbar holds *instances* (multiple pens/markers with different colours), right-click to duplicate/remove, drag to reorder.
- Default toolbar: Select, Hand, Marker (yellow, text mode), Pen (red), Text, Eraser.
- Tool options open in a flyout when clicking the active tool again.
- Status bar at the bottom (undo/redo, page nav, zoom, fullscreen) — hidden in fullscreen.
- Eraser removes whole objects; text boxes deleted via Select + Delete.
- Shift = straight line for freehand marker; Space/middle-mouse = temporary pan.
- Text box font: Helvetica (standard PDF font) in MVP.
- Annotation author default "JuliePDF"; annotations printable.
- No hover-reveal in fullscreen; encrypted PDFs show "not supported yet".
- Single app instance; opening another file adds a tab.
- Exact Deep Ocean secondary shades and Amber `#FFC107` as listed in §7.1.

**Left to the builder**
- Exact mechanism to suppress pdf.js drawing of managed annotations.
- Stroke smoothing/simplification algorithm details.
- Internal component breakdown and state-management details within the structure above.
