# Search Spec

Priority: `P0 demo`

Search is the current demo-critical product surface for public legal-source discovery, stored case retrieval, and source-grounded case pages.

This spec is separate from the legacy `atlas` spec because user-facing product language is now Search. Existing `atlas` names in packages, services, indexes, or environment variables are implementation debt unless a cleanup task explicitly changes them.

## Current Demo Decision

Phase 0.3 matter workflow and Phase 0.4 storage/jobs/offline work are paused for the DMU demo.

The next work is:

- make Search easier to use live
- keep Find Case Law integration reliable
- refactor the oversized legal search route module before adding more behavior
- return lean snippets in result cards instead of full paragraph payloads
- remove stale Search/Atlas compatibility scaffolding after tests pass

## Documents

- [Experience And Refactor](experience-and-refactor.md)
