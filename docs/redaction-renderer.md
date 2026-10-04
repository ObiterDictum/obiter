# Redaction Renderer

`services/redaction-renderer` turns a sanitized `.docx` into an intermediate
PDF. It exists because Obiter's page engine paginates in the browser:
`packages/app-shell/src/document-page-engine.ts` `layoutDocument()` measures
each line with a DOM canvas (`document-page-flow.ts` `wrapLines()`), so Node
cannot reproduce Word's line breaks. The worker runs that engine inside
headless Chromium and prints the pages Chromium laid out, rather than
reimplementing pagination server-side where it would break lines differently.

## Architecture

```
POST /render (sanitized .docx)
        │
        ▼
parse .docx ── @obiter/ooxml parseDocx ──► DocumentModelWire
        │
        ▼
headless Chromium ── app-shell StaticDocumentPages ──► painted pages
        │                                              (layoutDocument)
        ▼
Chromium page.pdf() ──► intermediate PDF (application/pdf)
```

- The API reaches the worker over a private port. The worker has no public
  route and does not contact any network service.
- The worker reuses the workspace's own engine and page components. It does
  **not** add a second document layout engine.
- Chromium is launched by Playwright as a child process. Playwright is a
  runtime dependency of this package only.

## The shared render boundary

`packages/app-shell/src/document-render.tsx` is the boundary:

- `layoutDocumentPages(model)` calls the same `layoutDocument()` the document
  workspace calls.
- `StaticDocumentPages` renders `DocumentDesk`, `DocumentPage`,
  `DocumentModelPage`, `PageTable`, `PageDrawing` and `ModelParagraph`'s
  read-only path, with every interactive prop omitted. No caret, selection,
  presence, draft, insert or tracked-change editing path is reachable.

`services/redaction-renderer/src/browser-entry.tsx` imports the boundary,
renders it into Chromium, waits for fonts, paint and image decode, and exposes
`window.__obiterRenderDocument` returning the page count and page-box
dimensions. `scripts/build-render-assets.ts` bundles that entry (Bun) and
compiles the Tailwind stylesheet the page components are written against
(`@obiter/ui/tailwind.css`) into `dist/render-bundle.js` and `dist/render.css`.
The stylesheet is required: table `table-fixed`, `whitespace-pre` line rows and
`min-h-[1em]` empty rows are layout, not decoration.

## Resource limits

Constants in `src/limits.ts`, enforced fail-closed:

| Bound          | Value  | Enforced at                       |
| -------------- | ------ | --------------------------------- |
| Input bytes    | 25 MB  | Before parse; HTTP body cap       |
| Page count     | 500    | After layout, before PDF          |
| Wall clock     | 60 s   | Layout and PDF, each              |
| Queued renders | 8      | Single Chromium page, FIFO        |
| Chromium heap  | 512 MB | `--js-flags=--max-old-space-size` |

A render beyond a bound returns a typed error and never a partial or degraded
artifact. The `.docx` package parser carries its own deflate/pack limits
(`@obiter/ooxml`), so a zip bomb is refused as `invalid_docx`.

## Isolation

- Runs as the deploying user, never root; Chromium's own sandbox stays on.
- Per render: a fresh `mkdtemp` directory under the worker's isolated base
  directory (mode 0700) holds the bounded input, removed in `finally` on
  success, failure, timeout and abort.
- Chromium keeps its profile under the same base directory, removed on
  `close()`.
- Chromium is launched with `--host-resolver-rules=MAP * ~NOTFOUND`, so the
  page cannot resolve a name even if a future component tried to.
- Only `GET /health`, `GET /ready` and `POST /render` are served. `/render`
  takes the raw `.docx` body (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
  and returns `application/pdf`.
- The client contract in `src/contract.ts` pulls in no server dependency, so
  the API can import it without loading Playwright.

## Failure behaviour

Every failure is `{ "error": { "code": string, "message": string } }`. Messages
are fixed and safe; no filename, document content, span text, PDF bytes or
object key is logged or returned. Unknown errors surface as `internal_error`,
never a partial PDF.

| Code                     | Status | Cause                          |
| ------------------------ | ------ | ------------------------------ |
| `unsupported_media_type` | 415    | Body is not a DOCX             |
| `input_too_large`        | 413    | Over the byte ceiling          |
| `invalid_docx`           | 422    | Unparseable or refused package |
| `unsupported_document`   | 422    | No renderable pages or box     |
| `too_many_pages`         | 422    | Over the page ceiling          |
| `not_ready`              | 503    | Chromium is still warming      |
| `at_capacity`            | 503    | Queue full                     |
| `render_timeout`         | 504    | Wall-clock bound fired         |
| `render_cancelled`       | 499    | Client disconnected            |
| `render_failed`          | 500    | PDF missing or invalid         |
| `internal_error`         | 500    | Unexpected failure             |

## Health and readiness

- `GET /health` is `200 {"status":"ok"}` as soon as the process listens.
- `GET /ready` is `503 {"status":"starting"}` until Chromium is launched, the
  page is warm and assets are injected, then `200 {"status":"ready"}`.
- `/render` returns `not_ready` rather than queueing before warm.

## Packaging and deployment

1. `bun install --frozen-lockfile`
2. `bun run --filter @obiter/redaction-renderer build` — writes `dist/`. A
   production image must run this, or `/ready` stays `503`.
3. Browsers: `bun --bun playwright install chromium` (or mount the Playwright cache).
   Browsers live under `~/.cache/ms-playwright` by default; `PLAYWRIGHT_BROWSERS_PATH`
   overrides.
4. Fonts: install `fontconfig` and `fonts-liberation`. Pagination and painted
   line breaks depend on the installed face set, and CI already pins
   `FONTCONFIG_FILE` for the same reason.
5. Start: `bun run --filter @obiter/redaction-renderer start`. Bind defaults to
   `127.0.0.1:8790`; `REDACTION_RENDERER_HOST` and `REDACTION_RENDERER_PORT`
   move it inside a private network or container.
6. Probe `/ready` for readiness and `/health` for liveness.

## Rollout and rollback

- The worker is additive and not yet called by the product: finalize does not
  use it in this change. Rolling it out does not change user-visible output.
- Deploy the worker, confirm `/ready` is `200`, then the consuming change wires
  `POST /render` into finalize behind its own flag/decision.
- Rollback is stopping the worker and reverting the consuming change. Finalize
  already fails closed to text output, so a rolled-back worker does not leave
  an unredacted artifact.

## Known limitations

- An image-only paragraph is positioned by `layoutDocument` but is not painted
  by the engine; a paragraph holding text and an image renders both. This is
  existing engine behaviour, not a worker decision.
- Package image parts in PNG, JPEG, GIF, BMP, WebP or SVG are supplied to the
  engine as data URLs. EMF, WMF and TIFF fall back to the engine's placeholder
  box.
- Headers, footers, tables, lists, footnotes and endnotes render through the
  same engine as the workspace. Floating shapes and text boxes render as the
  engine paints them.
- The output is an intermediate PDF for a later burn step; it carries a text
  layer and is not itself a redacted artifact.
