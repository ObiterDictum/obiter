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

## Documents

- [Experience And Refactor](experience-and-refactor.md)
