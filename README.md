# Paper reader

A right-sidebar paper reader for DeepSeek Harness. Upload a PDF and read it on a canvas rendered from the original PDF page, with PDF.js's text layer on top. The document is never converted to HTML, so fonts, images, figures, tables, equations, and column layout stay exactly as published. The full text is translated into Chinese automatically, and hovering a paragraph shows that paragraph's translation.

## Features

- **Right-sidebar entry** — appears as “论文阅读器 / Paper reader” in the sidebar guide.
- **Local library** — uploads are stored in IndexedDB on the device; the original PDF bytes are retained unchanged. Reopen a paper from the recent list, or delete it together with its annotations and translations.
- **Original-page rendering** — each PDF page is drawn from its own content stream, including embedded fonts and vector/raster figures. Bundled PDF.js CMaps, standard fonts, and wasm decoders avoid network fallbacks.
- **Layout-aware paragraphs** — opening a paper asks MinerU (when configured) for its layout blocks, so paragraphs follow the real column and block structure; without MinerU the bundled PDF.js text extraction builds them locally.
- **Automatic full-text translation** — every paragraph is translated into the chosen target language by the configured chat model. Progress appears under the paper title; results are cached per paper and language so a reopened paper never translates again.
- **Hover translation** — hovering a paragraph marks it and shows that paragraph's translation in a floating card below it, together with a one-line source excerpt. The paragraph under the pointer is resolved from normalized page geometry, so it works at any zoom or width.
- **Formulas** — the translator is told to keep LaTeX (`$…$`, `$$…$$`) intact, and the hover card renders it with KaTeX (MathML output, so no font or stylesheet payload). MinerU equation blocks are displayed the same way.
- **Text selection menu** — selecting text inside the reader opens a floating menu with:
  - Highlight
  - Add note
  - Ask in chat
- **Highlights and notes** — normalized page rectangles survive zoom and width changes; notes and highlights persist per paper.
- **Ask in chat** — the hover card carries an “Ask in chat” action that quotes the whole hovered paragraph, so no drag is needed. The text-selection menu keeps its own entry for a partial passage. Either way a dialog opens with a default prompt in the current UI language, inserts the prompt and the quoted passage (atomic quote on newer shells, Markdown blockquote on older shells) into the current composer, and leaves sending to the user.
- **Zoom and page navigation** — fit-width, step zoom, previous/next page, and page indicator.
- **Settings page** — Settings → Paper reader configures the MinerU token through the harness credential store, with a live status badge, the token's source, and a privacy note.

## Layout parsing

Paragraph boxes come from one of two sources, in this order:

1. **MinerU layout parse** — when a token is configured, the browser posts the original PDF to the plugin's Host route `POST /paper-reader/parse`. The Host uploads it to the MinerU cloud API (`/api/v4/file-urls/batch`), polls the batch, downloads the result ZIP, reads `layout.json`, and returns each page's `para_blocks` as normalized paragraph boxes. Titles, body text, lists, captions, and formulas each keep their own block, so a paragraph never spans two columns.
2. **Built-in PDF.js extraction** — used when MinerU is not configured, fails, or times out. It clusters text runs into baselines, detects per-page column gutters (empty vertical bands), and merges lines into paragraphs.

The parse is cached in IndexedDB per paper, so MinerU runs once per uploaded file. A parse failure falls back to the built-in extraction and shows an error toast.

### Configuring MinerU

Settings → Paper reader holds a token field. The value is stored through the harness credential store (`MINERU_TOKEN`) on the device, takes effect immediately — no restart — and a saved token is picked up by the parse route on the next request. The page also shows whether the token comes from the credential store or an environment variable, and a Remove button clears it again.

The same route also reads these sources, in this order:

1. The `paper-reader` row of the profile's `cordis.patch.yml`:

   ```yaml
   - id: paper-reader
     name: dsh-paper-reader
     config:
       mineru:
         token: sk-...
   ```

2. `MINERU_TOKEN` in the Host environment (or a credentials file the harness reads).

`mineru.endpoint` overrides the API base URL (default `https://mineru.net/api/v4`) for a compatible self-hosted deployment.

With MinerU enabled the PDF itself is uploaded to that service; without a token nothing leaves the device except paragraph text for translation.

## Translation

The browser half never holds translation credentials. It posts paragraph batches to the plugin's own Host route `POST /paper-reader/translate`.

The configured chat model (the default model from Settings, e.g. `deepseek-flash`) translates each batch first: thinking is disabled, temperature is 0 so random sampling cannot break a formula mid-marker, and the answer must come back as `[[n]]`-marked segments. Before each request the Host swaps every formula, LaTeX command, URL, and DOI for an opaque `⟦n⟧` placeholder (the protection pipeline behind Agentero's PDF translation), so the model translates prose only and a formula it never sees cannot be rewritten. A segment whose placeholders come back missing, duplicated, or invented is retried alone, then, if it still fails, translated fragment by fragment between the placeholders; a segment that fails every rung falls through to the Host `translator` service's free anonymous routes (`bing`, then `google`) — the same route that fills segments the model drops and the whole batch when the model route is unavailable. So a paper that the model translates cleanly never sends text to Microsoft or Google.

Set `config: { mode: 'service' }` on the `paper-reader` row in `cordis.patch.yml` to skip the model entirely and translate only through the anonymous routes.

Pin the translation model independently of the chat default model with `translation.provider` / `translation.model` on the same row:

```yaml
- id: paper-reader
  name: dsh-paper-reader
  config:
    translation:
      provider: bifrost
      model: sgl/deepseek-v4.1-flash
```

A pinned model must answer without narration: the batch answer is split on `[[n]]` markers, so a model that writes a preamble before the first marker loses that batch to the slower anonymous routes. Choose a model that follows the marker format directly.

Each request carries at most 10 model-translated paragraphs (24 in service mode), 12 000 characters per paragraph, and 8 000 characters per model batch; the browser keeps four batches in flight. Pages are translated in an order derived from the current page: the visible page first, then pages by increasing distance, forward pages before backward pages at the same distance, so the paragraphs under the reader's eyes arrive first and the next page is ready before it is scrolled to. A failed page stops only its own batches and retries after a 15-second cooldown on the next page change or manual attempt; failures are reported per paragraph, so the reader keeps the paragraphs that succeeded.

Translations are stored in IndexedDB, keyed by paper and target language, together with the source text of each paragraph and the extraction-geometry version. A changed geometry version, a different source text, or a deleted cache entry simply re-derives the paragraph instead of reusing a stale box.

### Target language

The toolbar has a language picker with Chinese (simplified and traditional), English, Japanese, Korean, German, French, Spanish, Russian, and Portuguese. The choice applies to the open paper, is remembered across sessions in `localStorage`, and each language keeps its own cache entry, so switching back and forth never re-translates the same paragraphs. Any well-formed BCP 47 tag is accepted by the Host route; the picker only lists the languages above.

Paragraph text is sent to the chat model for translation (and, only for paragraphs the model misses, to the anonymous Microsoft/Google endpoints). The PDF never goes to those translation endpoints; it only goes to MinerU when that is configured.

## Performance notes

- Resizing the sidebar is debounced (160 ms, 6 px dead band), so pages re-render once after the drag instead of on every frame.
- Pages are memoized: translation progress updates and hover changes do not re-render other pages' JSX.
- Only pages within 700 px of the viewport draw a canvas; offscreen pages render when they scroll in. Each canvas is capped at a 6 MP pixel budget.
- The MinerU result ZIP is indexed first and only `layout.json` is inflated, so large result images never block the Host event loop.

## Build

Requires Node.js 20+.

```sh
npm install
npm run build
```

The build generates `src/generated/pdf-worker-source.ts` and `src/generated/pdf-assets.ts` from `pdfjs-dist`, then emits:

- `lib/client.js` — small sidebar shell, lazy-loads the reader
- `lib/client.reader.js` — PDF engine, worker source, and compressed PDF.js assets
- `lib/index.js` — host companion: the bounded translation route

The PDF engine is only requested when a paper is opened.

`lib/` and `src/generated/` are build output and are not tracked in git; `package.json` `files` collects them into the published tarball. The build is reproducible — a clean `npm install && npm run build` on the tagged commit reproduces the release artifacts byte for byte.

## Install into a profile

From a release tarball (no build step, no pnpm approval prompt):

```sh
dsh plugin --profile desktop add https://github.com/Aliancn/paper-reader/releases/download/v0.1.0/dsh-paper-reader-0.1.0.tgz
```

From a local checkout (after building):

```sh
npm install && npm run build
dsh plugin --profile desktop add file:/absolute/path/to/paper-reader
```

From the GitHub source (pnpm will ask before running the `prepare` build script):

```sh
dsh plugin --profile desktop add github:Aliancn/paper-reader
```

The package declares `dsh.bundle`, so the CLI appends it to the profile's bundle list. The bundle patch inserts the `paper-reader` loader row; no manual patch is needed.

Restart the host after installing so it re-reads its environment and serves the new client bundle.


## Storage

- Paper files and metadata: IndexedDB database `dsh-paper-reader`
- Annotations: IndexedDB store `annotations`, keyed by paper and indexed by `paperId`
- Translations: IndexedDB store `translations`, keyed by `paperId::language`
- MinerU parses: IndexedDB store `parsed`, keyed by `paperId`
- Last opened paper: `localStorage` key `dsh-paper-reader:last`
- Chosen target language: `localStorage` key `dsh-paper-reader:language`

Uploads are limited to 200 MB. The PDF itself stays on the device; only paragraph text is sent to the translation endpoints described above.

### When the device is full

Browsers cap how much a site may store, and the cap is often far below what a library of PDFs needs. An upload that exceeds it raises `QuotaExceededError`; the reader then frees room and retries once:

1. Every cached MinerU parse and translation is cleared — both are rebuilt on demand, so nothing the user typed is lost.
2. The least recently opened papers are deleted, at most three per upload, never the paper being opened right now.

If that still is not enough the upload fails with a "ran out of space" message instead of an unexplained storage error, and the list refreshes so the deleted papers disappear immediately. Highlights and notes are deleted together with their paper, so the eviction order is the stalest paper first.

## Tests

```sh
npm test
```

The suite runs on `node:test` with no extra dependencies (Node 22 strips the TypeScript types). It covers target-language resolution and validation, paragraph extraction geometry (including two-column pages), translation batching and splitting, quota detection, and the eviction order.

