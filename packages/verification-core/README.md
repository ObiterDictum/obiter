# Verification core

Pure domain vocabulary for Verify. No storage, no network, no provider calls, no
UI. It defines the values Verify passes between extraction, resolution, checks,
persistence and reporting; it defines none of those steps itself.

## Responsibility

`@obiter/verification-core` owns:

- a citation as it appears in a draft, and the normalized identity a check can
  act on;
- the verification subject (the immutable draft version under check) and draft
  locations (paragraph id plus character offsets, never text);
- evidence references that point at public legal source material by id, so a
  finding can be traced back to the paragraph or provision it rests on;
- finding identity, type, severity, confidence, and the conservative status
  model, including the explicit review-required state.

Every value here is deterministic, serialisable and free of matter content. The
only text any value holds is the citation string itself, which is public
reference material, not the document around it.

## Ownership boundaries

- **`packages/contracts`** owns wire shapes: HTTP request and response bodies,
  error envelopes, and cross-package contracts. Verify's API contracts (the
  routes in `docs/specs/verify/api.md`) belong there and land with the API. This
  package holds domain values; the API layer maps them into contracts shapes.
  `packages/contracts/src/legislation-paths.ts` also owns the canonical
  `/ln/...` path grammar, which this package reuses rather than re-parsing.
- **`packages/legal-schema`** owns the legal source record vocabulary
  (`LegalSourceType`, `LegalAuthority`, `LegalParagraph`). Evidence references
  import `LegalSourceType` and point at legal-schema ids instead of redefining
  source kinds.
- **Search and Atlas code** owns retrieval, citation recognition and authority
  resolution. `services/api/src/routes/legal-search/legislation-citations.ts`
  recognises free-text legislation citations, the editor's neutral-citation
  regex in `packages/app-shell/src/document-authorities.ts` recognises case
  citations, and `packages/search-client` owns the judgment evidence id format
  (`<documentId>:judgment_paragraph:<ordinal>`). This package does not parse
  free-text citations and does not query Meilisearch, Postgres or Atlas. V2 and
  V3 call those layers and hand the results to this vocabulary.
- **Future Verify API, worker and UI** (V2 onwards) validate untrusted input with
  contracts schemas at the boundary, run checks in the worker, and render
  findings in the UI. All three consume this package and none add a parallel
  finding, status or evidence vocabulary.

## Non-goals

Deliberately absent, and owned by later board items:

- authority existence checks (V2);
- citation resolution checks and free-text citation normalisation (V3);
- quote comparison (V4);
- findings UI (V5);
- verification artifact export (V6);
- proposition extraction and claim support classification (V7, V8);
- extended findings UI (V9);
- persistence, queues, routes, React and provider calls.

Claim support statuses (`supported`, `weak_support`, `contradicted`,
`unsupported`, `not_checked`, `manual_review_required`) from
`docs/specs/verification-evidence.md` are also deliberately absent: they classify
claim support, not check outcomes, and V8 owns them.
