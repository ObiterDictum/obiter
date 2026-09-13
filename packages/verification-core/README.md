# Verification core

Pure domain vocabulary for Verify. No storage, no network, no provider calls, no
UI. It defines the values Verify passes between extraction, resolution, checks,
persistence and reporting; it defines none of those steps itself.

## Responsibility

`@obiter/verification-core` owns:

- a citation as it appears in a draft, and the normalized identity a check can
  act on;
- the verification subject (the immutable draft version under check) and draft
  locations (paragraph id plus UTF-16 offsets into the paragraph's plain-text
  projection, never text);
- evidence references that point at public legal source material by id, so a
  finding can be traced back to the paragraph or provision it rests on;
- finding identity, type, severity, confidence, and the conservative status
  model, including the explicit review-required state.

## What the values hold

Two kinds of field are deliberately different, and the distinction is the point:

- **Identifiers and coordinates are metadata only.** Generated finding ids and
  evidence ids are built from subject/location ids and offsets: no citation text,
  quote, explanation, filename, matter name or user text. Enums, offsets and
  paragraph ids are the same kind of value.
- **Two payload fields can carry text.** `citation.rawText` is the cited string
  verbatim, and a named authority citation can contain a party name, which can be
  the client's. `explanation` is authored by Verify and may quote matter while
  explaining a finding. Neither is an identifier, and neither is bounded here.

So the package is not "free of matter content". Its identifiers are; its two
text payloads are not, by design. `docs/specs/verify/domain-model.md` records the
accepted finding states, and `docs/specs/verification-evidence.md` sanctions
showing bounded citation text to a reviewer.

## Contracts this package pins

- **Offset unit and projection.** `DraftLocation.start`/`end` are UTF-16 code
  units into the paragraph's plain-text projection
  (`paragraphPlainText` plus extra runs, or an inserted paragraph's text), the
  same indices `String.prototype.slice` uses. `extractAuthorities` in
  `packages/app-shell` is the producer convention. The range is half-open and
  zero-length spans are invalid.
- **Canonical identities.** Legislation identities are the canonical
  `ukpga/YYYY/N` form with canonical label paths; judgment source ids are
  `LegalAuthority.id`. Both schemas reject values the canonical grammar would
  reject, including traversal-shaped and percent-encoded path segments.
- **Evidence and source agree.** A clear or flagged finding must cite at least
  one evidence reference, and every reference must name the same public source as
  its resolved citation. Judgment and legislation references cannot cross.
- **Finding identity.** `createVerificationFindingId` is a deterministic
  idempotency key for one immutable version, check type and draft span, encoded
  with length-prefixed components so distinct inputs cannot collide on `:`.
  `verificationFindingSchema` accepts only that derivation, so an arbitrary
  string (or matter text) is not a valid finding id.

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

## Boundary limits this package does not set

The package is pure and trusts its caller. The API, queue and persistence
boundaries that accept these values own:

- length and count limits on `citation.rawText`, `explanation` and the
  `evidence` array;
- the check that `citation.rawText` equals the draft slice at its location
  against the stored immutable version (the schema only checks the unit and
  length);
- tenant/organisation/matter scoping and authorisation;
- source-version pinning for evidence, which the shared
  `<documentId>:judgment_paragraph:<ordinal>` format does not carry.

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
