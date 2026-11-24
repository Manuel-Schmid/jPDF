# Page pictures and a better prompt for explanations: design

Follow-up to #99 (one-click explanations through Claude Code / Codex CLI,
branch `feat/99-cli-explanations`). Built on branch
`feat/explanation-images`, stacked on #99, as its own PR.

## Intent

Explanations are meant for studying lecture slides. Testing #99 on two real
decks (Distributed Systems lecture 6, 56 pages, Claude Opus; ESS chapter 1b,
32 pages, half Codex, half Claude) showed the results are not good enough:

1. **Filler.** About half the explanations open with "This slide shows / This
   is / The slide …", which says nothing.
2. **Pictures are invisible.** Only page text is sent. Slides whose content is
   a figure, screenshot or diagram get guesses ("apparently consisting only of
   figures… most likely recalls…", DS 9/10), wrong claims ("the slide itself
   has no further content", ESS 32, which shows two full flow diagrams), or no
   explanation at all (DS 14, the Slido results, is an image).
3. **Questions are not answered.** Exam tasks, quizzes and discussion
   questions only get restated (DS 15/16 exam 2023: "the content is not
   visible… most likely asks you to…"; ESS 13, ESS 29). Where Claude did give
   solutions (ESS 19, 24, 31) the explanation was the most useful in the deck.
4. **Diagrams get generic reading instructions** instead of their content
   (ESS 6 never names its actors and use cases; ESS 5 omits which UML diagrams
   are the course focus; ESS 16 ignores the quality-model diagram).
5. **Animation builds repeat the setup** (DS 18–28) instead of saying what is
   new on each step.
6. **The fixed "2 to 4 sentences"** pads trivial slides and squeezes dense
   ones.

The user wants explanations that explain the concepts, key takeaways,
questions and other study-relevant content clearly, correctly and pointedly,
and wants slide pictures included because much of the information in
university slides is in images, diagrams and visualizations.

## Goals

- A rewritten shared prompt (both CLIs) built from the rules below.
- Page pictures sent with the request: rendered by the app from the original
  page (never the user's annotations), only where useful by default, every
  page as an option in Settings → AI.
- Cross-references kept: every request carries the text of the whole
  document; pictures only for the pages explained in that request.
- Scanned pages (no text) get explained from their picture.

## Non-goals

- Changing storage, the explanation field, undo, Retry, cancel, CLI lockdown
  or discovery from #99/#88.
- Rendering in Rust (would need a PDF rasterizer such as pdfium: a large new
  dependency; against the "keep it light" rule).
- Letting the model open files itself (would need its file tool; slower,
  costlier, see Approaches).
- Rich text in the field (the field shows plain text; the prompt asks for
  plain text).

## Anti-goals

- Slowing the app when not generating: nothing new runs at startup or on the
  drawing/rendering paths; picture work happens only after the click.
- Sending the user's annotations (notes, highlights) as if they were lecture
  content.
- Silent, unbounded plan usage: the setting says pictures use more of the
  plan.

## Constraints

- Tauri 2 + Svelte 5 + TS, Rust backend; no new crate, no new npm package.
- Both CLIs verified on this machine to accept pictures while fully locked
  down (2026-11-25):
  - **Claude Code 2.1.331:** with `--input-format stream-json` a single user
    message whose `content` mixes `{"type":"text"}` and
    `{"type":"image","source":{"type":"base64","media_type":"image/png","data":…}}`
    blocks works with `--tools ""` and the other #99 lockdown flags
    (answered a colour question about a test PNG correctly). The system prompt
    stays in `--system-prompt`. stdin is closed after the one message; the CLI
    answers and exits. Output stays `stream-json` with partial messages.
  - **Codex CLI 0.172.0:** `-i, --image <FILE>...` attaches files to the
    prompt; works with all #99 lockdown flags. The flag is variadic, so pass
    each picture as `--image=<path>` (one argument each) so it cannot swallow
    the trailing `-` (prompt on stdin).
- Every feature/fix comes with tests (vitest, cargo).

## Approaches

1. **App renders pictures with pdf.js; Claude gets them inline as image
   blocks in its input stream; Codex gets files in the run's temp folder via
   `--image`** (chosen). pdf.js already renders the pages; inline pictures
   arrive with the first request, so the answer starts streaming at once.
2. Claude opens picture files with its file tool: needs the tool enabled,
   adds a tool round trip per picture (slower), re-sends the conversation on
   each turn (more plan usage), and the model may skip pictures it wrongly
   thinks unimportant. Worse on every count; rejected.
3. Rendering in Rust with pdfium: large native dependency; rejected.

## The new prompt

`src/ai/prompt.ts` keeps one `SYSTEM_PROMPT` shared by both CLIs. New text
(exact copy; the builder may fix typos only):

```
You write study explanations for the pages of a document, usually university lecture slides, for a student preparing for the exam. You get the text of the whole document for context, and pictures of some pages.

For each page you are asked to explain:
- Start directly with the substance: the concept, claim or result. Never begin with "This slide", "This page", "The slide shows" or similar, and do not describe the slide itself.
- Explain the concepts clearly, correctly and precisely: what they mean, why they matter, and how they connect to concepts from earlier pages (name the concept, not the page number).
- For questions, quizzes, exercises and exam tasks, give a concise model answer with the key reasoning.
- For diagrams, figures, tables and code, say concretely what they show (the elements, how they relate, what the code computes) and what to take away from them.
- If a page repeats the previous page with an addition (an animation step), explain only what is new.
- For title, agenda, break, literature and "Questions?" pages, write one short sentence.
- Add a short concrete example only when it really makes a concept easier to understand and the page does not already give one. Most pages need no example.
- Do not guess. If part of a page cannot be read, say so in a few words instead of speculating.
- Where it matters, distinguish the lecturer's own view or a course convention from generally accepted facts.
- Let the length follow the content: one sentence for trivial pages, usually two to five for content pages, at most about six.
- Plain text only: no Markdown, no bullet characters, no headings.
- Write in the language of the document.

Answer with exactly one JSON object per line and nothing else (no code fences, no comments), in page order:
{"page": <page number>, "text": "<explanation>"}
Use the page numbers exactly as given. Escape quotes and line breaks inside the text as JSON requires.
```

### The user message

Built by `userPrompt` from: all page texts of the document, the pages to
explain in this request, and which of them have pictures.

- Whole document in one request:
  `Explain all N pages of this document (one JSON line per page: K lines). Pictures of pages a, b, c are attached.` followed by the page texts
  (`=== Page n ===` blocks, as today).
- Document split into several requests: first
  `Document text (all N pages, for context):` with every page's text, then
  `Explain pages x–y of this document (one JSON line per page: K lines). Pictures of pages a, b, c are attached.`
  Only pages in the request's range are explained; the rest is context.
- Pages without text appear as `=== Page n ===\n(no text; see its picture)`
  when they have a picture, and are left out otherwise (as today).
- Picture labelling: Claude gets, for each picture, a text block
  `Picture of page n:` immediately followed by the image block, after the
  main text. Codex gets the pictures in page order and the sentence
  `The attached pictures show pages a, b, c, in this order.`
- The "no pictures" sentence is omitted when a request has none.

## Which pages get a picture

New preference `aiPictures: 'useful' | 'all'`, default `'useful'`.

- `'all'`: every page with content (source pages; blank inserted pages
  never).
- `'useful'`: a page gets a picture when any of these holds (decided from
  pdf.js data only, after the click):
  1. It has little text: under 200 characters after cleaning (includes
     scanned pages with no text at all).
  2. It draws an image covering at least 8 % of the page area. Determined
     from `page.getOperatorList()`: track the current transform through
     `save` / `restore` / `transform` (and `paintFormXObjectBegin` matrices),
     and for `paintImageXObject`, `paintInlineImageXObject`,
     `paintImageMaskXObject` (and their `…Group`/`…Repeat` variants) take the
     area of the unit square under the current transform. Small images (logos,
     icons such as the HSG logo or the "light bulb" marker on every slide) stay
     below the threshold.
  3. It draws vector graphics that look like a diagram: at least 25
     `constructPath` operations that are filled or stroked. Slide-template
     frames and a few boxes stay below.
  Thresholds are constants in one module, tuned on the two test decks; the
  builder adjusts them if a deck's results show obvious misses or waste and
  records the final values and why.
- **Empty pages** *(designer's call)*: a source page with no text, no image
  and fewer than 3 filled/stroked paths counts as empty. Empty pages get no
  picture and no explanation in either mode and keep #88's "no text" note.
  `'all'` therefore means every non-empty source page. `noTextPages` now
  holds only empty pages (pages with a picture are explained instead).
- **Models without picture support** *(designer's call)*: all current Claude
  models accept images. Codex's `model/list` reports `inputModalities`; keep
  it in `CliModel` (`images: boolean`) and, when the chosen Codex model lacks
  `"image"`, send text only and show "This model can't read pictures; only
  page text is sent." under the model in Settings. Unknown models (typed by
  hand, list failed) get pictures; a CLI error is shown as usual.
- Known trade-off: a full-bleed background photo (e.g. the concrete photo on
  the DS title and agenda slides) counts as an image; acceptable.

## Rendering pictures

- In the frontend with pdf.js, from `session.doc`, with
  `annotationMode: AnnotationMode.DISABLE` (no annotations at all: neither
  the user's saved notes nor the session's), honoring the page's rotation as
  shown to the user (`PageEntry` rotation added to the page's own rotation).
- Size: long edge 1280 px; encoded as JPEG quality 0.8 via `OffscreenCanvas`
  `convertToBlob` (smaller than PNG for slides with photos, still sharp for
  text at this size). Base64 for transport.
- Done after the page texts are read, in batches of 4 pages, calling
  `page.cleanup()` after each, with progress in the status bar
  ("Preparing pictures 12/30"). Cancel stops it. The canvas is released after
  encoding (see the thumbnail renderer for the pattern).
- Only pictures needed by the request about to be sent are kept in memory;
  each chunk's pictures are rendered right before that chunk is sent and
  dropped after it (so a 300-page deck never holds 300 pictures).

## Requests and chunking

- *(Designer's call)* A generation (and every Retry) has two phases before
  the first request: (1) read the text of **all** pages (context, also on
  Retry) and the operator lists of the pages to explain, and decide which
  of them get pictures (cheap, no rendering; status "Preparing pages n/m");
  (2) cut chunks, then per chunk render its pictures and send it. The
  pictures of the next chunk may be rendered while the current request runs.
- Pages to explain are worded as a range (`pages 12–40`) when contiguous and
  as a list (`pages 5, 17, 18, 40`) otherwise (Retry).
- Every request carries all page texts (context) when they fit within the
  existing `maxInputChars` (400 000); otherwise the context is the pages
  within ±40 of the chunk (the builder may pick a different window if
  testing shows a need; record it).
- Pages explained per request:
  - Claude: up to 150 without pictures (as #99), but at most **40 pages with
    pictures** per request.
  - Codex: 20 per request (as #99), all of which may have pictures.
- *(Designer's call)* Chunk rule: the number of chunks is the smallest n such
  that every chunk, cut in order into n parts of even page count, has at most
  the page limit (150 Claude / 20 Codex) and at most 40 pictured pages
  (Claude). If even page counts can't meet the picture cap (pictures bunched
  together), cut greedily in order at the cap instead. Priority: fewest
  requests, then even sizes. Retry uses the same rule on the pages it asks
  for.
- Silence timeouts (120 s Claude / 300 s Codex) may be raised if the
  evaluation shows long silent stretches with many pictures; record it.

## Backend changes (Rust)

- `ai_cli_generate` gains `images: Vec<PageImage>` with
  `PageImage { page: u32, media_type: String, data: String /* base64 */ }`.
- Claude: switch generation to `--input-format stream-json`; stdin carries one
  line: a `{"type":"user","message":{"role":"user","content":[…]}}` object with
  the text block(s) and, per picture, the `Picture of page n:` text block and
  the image block. All #99 lockdown flags stay; tests assert them.
- Codex: decode each picture into the run's temp dir as `page-<n>.jpg`, add
  `--image=<path>` per picture before the trailing `-`. The temp dir is already
  removed after the run.
- Limits: reject a request with more than 60 pictures or more than 40 MB of
  picture data with a clear `AiCli` error (safety net; the frontend never
  sends that much).

## Settings

Settings → AI (Beta), under Effort:

```
Page pictures        [ Where useful | Every page ]
                     Pictures help with diagrams, screenshots and scanned
                     pages, and use more of your plan.
```

## Evaluation (part of done)

Re-generate both test decks with Claude (Opus, medium) and the ESS deck with
Codex, and check these pages against the analysis:

- DS 9, 10 (figures), DS 14 (Slido results image), DS 15, 16 (exam tasks
  with model answers, lazy evaluation on 16), DS 18–28 (animation steps say
  what is new).
- ESS 5, 6, 16, 32 (diagram content named), ESS 13, 29 (questions answered),
  any page (no "This slide …" openings, no "presumably/probably").

Record the before/after for these pages in the PR description. This uses a
little of the user's plans and is approved for this check.

## Tests

- Prompt: the system prompt contains the key rules (no "This slide"
  opener rule, model answers, diagrams, animation steps, examples rule, plain
  text, JSON format); `userPrompt` for one chunk / several chunks / pages
  without text / picture sentence for Claude and Codex.
- Picture selection: unit tests over synthetic operator lists (logo below
  threshold, large image above, scaled through nested transforms and form
  XObjects, many paths, few paths, little text) and both setting values.
- Rendering: annotations disabled, rotation applied, long edge 1280, JPEG;
  cleanup and cancel (mocked pdf.js).
- Chunking: 40-picture cap for Claude, context window fallback over 400 000
  characters, Retry ranges.
- Rust: Claude stdin JSON shape with images (and lockdown flags still
  present), Codex `--image=` args before `-`, picture files written and
  removed, limits.
- Settings: the new control, default `useful`.

## Left to the builder

- Final thresholds and the context window, measured on the two test decks
  (record them).
- Exact progress wording in the status bar.
- Whether rendering runs in a worker or on the main thread in small batches
  (must not freeze the UI; measure on the 56-page deck).
