# Search Spec

Priority: `P0 demo`

Search is the current demo-critical product surface for public legal-source discovery, stored case retrieval, and source-grounded case pages.

This spec is separate from the legacy `atlas` spec because user-facing product language is now Search. Existing `atlas` names in packages, services, indexes, or environment variables are implementation debt unless a cleanup task explicitly changes them.

## Current Demo Decision

Phase 0.3 matter workflow and Phase 0.4 storage/jobs/offline work are paused for the current demo priority.

Completed foundation:

- preserve the current Find Case Law integration through the route split
- split the oversized legal search route module into `services/api/src/routes/legal-search/`
- rank strong title and party-name matches ahead of body/reference-only matches

The next work is:

- make Search easier to use live
- return lean snippets in result cards instead of full paragraph payloads
- add debounced auto-search, keyboard navigation, idle state, and filter removal
- remove stale Search/Atlas compatibility scaffolding after tests pass

## Legislation Index Rebuild

`services/api/src/rebuild-legislation-index.ts` rebuilds the `legislation_provisions` index from Postgres, which is the system of record, through a staging index that is swapped in atomically. The rebuild is repeatable and idempotent.

- Only provision rows are indexed. Part, Chapter, Schedule and crossheading rows are headings with no searchable body.
- Provisions flagged `has_unapplied_effects` are indexed with the flag. The serving layer withholds their text and needs the flag to do so without a live call; excluding them would make amended provisions unfindable instead of honestly labelled.
- Engine ids use the hyphenated path form because engine ids reject slashes; the full path stays queryable in `provisionRef`.
- Timestamps are normalised to ISO strings at write, because `pg` returns `timestamptz` as a `Date`.

The script has no exported unit and needs a live Postgres and Meilisearch, so these rules are recorded here rather than proved by a test.

## Search Index Rebuild

`services/api/src/rebuild-search-index.ts` rebuilds the product index from Postgres, which is the system of record, through a staging index that is swapped in atomically. It is repeatable and idempotent, and it is not a migration: it derives the index from current rows.

- Rows with only `summary_json` and no `document_json` are indexed as summaries and counted separately. Paragraphs are optional in the authority schema, so a summary-only row still answers exact citation, id and title lookups; dropping those rows would narrow the derived index below what Postgres holds.
- Withdrawn rows are excluded from the derived index and counted, because the mark survives in Postgres and the index simply stops serving the document.
- The paged read runs on one client inside a single `REPEATABLE READ` transaction, so every page sees one snapshot. Keyset paging on `document_id` is stable under concurrent inserts; `document_id` is a hash, so a row inserted below a cursor would otherwise be missed.
- Memory is bounded by one page plus one HTTP payload batch. Each page is validated as it is read; the first bad row aborts the run with the product index untouched. An abort deletes the staging index, and the product index is only touched by the atomic swap after every batch succeeds.
- Readiness is verified after the swap and the run exits non-zero unless the product index reports ready with the expected document count, so a partial rebuild can never be called ready.

The script has no exported unit and needs a live Postgres and Meilisearch, so these rules are recorded here rather than proved by a test.

## Documents

- [Experience And Refactor](experience-and-refactor.md)
