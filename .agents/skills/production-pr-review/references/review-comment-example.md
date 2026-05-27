# Review Comment Example

Use this shape for request-changes or comment reviews. Adapt the details; do not copy claims that were not verified.

```markdown
## Review Verdict

Decision: Request changes

Score: 68/100

Merge readiness: Not mergeable until indexing only reports success after Meilisearch confirms the write task succeeded.

Why: The ingestor currently treats an accepted Meilisearch task as completed indexing, so deployment logs and exit codes can claim Atlas data is searchable while the provider later fails the task. That is a correctness bug in the foundation layer because later Atlas, Verify, and Research workflows will trust these indexed-count reports. I also found a response-shape issue where search can return full paragraph payloads instead of summary results, which should be corrected before real corpus records are indexed.

What would change the verdict: wait for Meilisearch write tasks to reach `succeeded`, convert failed/canceled tasks into the sanitized report shape, restrict search results to summary fields, and add tests for both behaviors.

Confidence: High. The Meilisearch client API documents document writes as enqueued tasks, and the changed code does not wait for task completion.

## Must Fix

- **High/bug - Indexing reports success before Meilisearch finishes** (`packages/search-client/src/index.ts:133`)
  - Problem: `addDocuments` only enqueues a task, but the code reports `indexedCount` immediately.
  - Impact: the ingestor can exit 0 even if the indexing task later fails, leaving Atlas search incomplete while deployment logs claim success.
  - Fix direction: wait for the task to reach `succeeded`; map failed/canceled tasks into the sanitized report shape.
  - Verification: add a test where the task is accepted and later fails, then confirm the ingestor exits/report fails.

## Findings

- **Medium/architecture - Search returns full paragraph payloads** (`packages/search-client/src/index.ts:151`)
  - Problem: search hits return the full authority schema, including paragraph arrays.
  - Impact: search responses can become oversized and blur the intended boundary between summary search and evidence retrieval.
  - Fix direction: restrict retrieved attributes to summary fields and keep paragraph text behind the paragraph retrieval endpoint.
  - Verification: add a search test proving paragraph text is not returned from `GET /api/atlas/search`.

## Security / Data / Isolation

Reviewed the API-to-Meilisearch boundary, key separation, fixture contents, provider error wrapping, and response payload shape. No key leakage found. Residual risk remains around result payload size until search responses are limited to summary fields.

## System / Coverage Map

Loaded `references/maps/ormont-system-map.md`, `review/ormont/architecture/data-boundaries.md`, and the search findings patterns. Traced the API-to-search-client-to-Meilisearch write path and inspected the search response contract. No private matter data boundary was touched, but source-of-truth versus derived-index behavior remained relevant.

## Verification

- `pnpm --filter @ormont/search-client test` - passed
- `pnpm --filter @ormont/api test` - passed

## Gaps / Follow-Ups

- Hosted Meilisearch task-failure behavior was not exercised against a live service in this review.
```
