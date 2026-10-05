# @obiter/redaction-renderer

Private, sandboxed DOCX to PDF rendering worker. It runs the shared app-shell
page engine inside headless Chromium so a sanitized `.docx` paginates exactly
as the workspace does, and prints the laid-out pages to an intermediate PDF.

It is not called by the product yet; the API will consume `src/contract.ts`
over a private port.

- Design, limits, isolation, packaging and rollout: [docs/redaction-renderer.md](../../docs/redaction-renderer.md)
- HTTP surface: `GET /health`, `GET /ready`, `POST /render` (DOCX body, PDF response)

```bash
bun run build   # writes dist/ (browser bundle + compiled stylesheet)
bun run test    # builds, then runs the worker suite against real Chromium
bun run start   # serves on REDACTION_RENDERER_HOST:REDACTION_RENDERER_PORT
```
