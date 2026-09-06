# legal-ingestor

Bulk ingestion from Find Case Law into Postgres `legal_source_documents`
only. The Meilisearch product index (`legal_authorities`) is derived and
populated only by `pnpm rebuild:search-index`; this service never writes it.
The fixture seeder (`src/index.ts`) stays on `legal_authorities_fixtures`.

## Commands

```bash
# Full measured scope (~38k docs, ~6h at the settled rate)
DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter pnpm bulk:ingest

# Bounded slice (verification, trial runs)
DATABASE_URL=... pnpm bulk:ingest --court=uksc --max-pages=2
DATABASE_URL=... pnpm bulk:ingest --court=ewhc-kb --from-date=2024-01-01 --max-docs=200
```

Flags: `--court` (repeatable comma list, slash or dash form),
`--from-date` / `--to-date` (apply when `--court` is given),
`--max-pages`, `--max-docs`, `--gap-ms` (default 600).

Default scope: UKSC, UKPC, EWCA-Civ, EWCA-Crim complete; EWHC divisions
decided from 2020-01-01. Older EWHC is backfilled later by moving one date
parameter.

## Politeness

Sequential loop, 600 ms between upstream requests (~1.5-2/s), the shared
`createMojRateLimiter` sliding window as a backstop, `retry-after` honoured
on 429. Well under the published 1000 requests per rolling 5 minutes, so a
shared office IP never gets blocked; slow is cheaper than blocked.

## Resume and idempotency

`legal_ingestor_progress` records the last completed atom page per scope; a
re-run continues from there. Documents compare `content_hash` before
fetching bodies, so completed work is skipped without re-fetch. Corrections
upstream land automatically: a changed hash re-fetches and upserts.

Run summary counts per court: stored, skipped-unchanged, skipped-no-fulltext
with reason, failed with reason. PDF-only judgments are stored as summaries
so the rebuild still indexes them, and counted as skipped, never silently
dropped.

## Incremental catch-up

The Find Case Law Atom feed is newest-first: judgments published since the
last run land on page 1, ahead of the stored page cursor. Every run
therefore re-polls pages 1..cursor before continuing past it. Stored
documents compare `content_hash` before fetching bodies, so the re-poll
costs only Atom page fetches plus one hash lookup per document — bodies
are not re-fetched. Re-running the same command is the poller. Suggested
schedule: weekly via cron or the existing job runner, e.g.

```cron
0 2 * * 0  cd /srv/obiter/sargassum/services/legal-ingestor && DATABASE_URL=... pnpm bulk:ingest
```

then `pnpm rebuild:search-index` from the repo root.

## Withdrawals (deferred)

Corrections are handled (see above). True withdrawals — a judgment removed
or replaced upstream — are not: nothing deletes today. Follow-up is a pass
that re-fetches stored ids and marks `provider_json.withdrawn` with an audit
log instead of deleting, then excludes withdrawn rows from publication via
the rebuild. Tracked as `TODO(withdrawals)` in `src/bulk-ingest.ts`.

## Licensing provenance

Every row carries `provider_json.provider=find-case-law`,
`licenceClass=tna-transactional-2026-07-15`, `acquiredAt`, `sourceUrl`.
Serving-side follow-ups (not in this service): render the acknowledgement
"Crown copyright material reproduced by permission of The National Archives.
The contents of the judgment can be used under the Open Justice - Licence.",
keep judgment content out of search-engine indexing (robots/noindex), remove
withdrawn material from publication on withdrawal handling, and state that
coverage is partial.
