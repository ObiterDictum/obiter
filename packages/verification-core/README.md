# Verification core

Pure domain vocabulary for Verify. No storage, no network, no provider calls, no
UI. It defines the values Verify passes between extraction, resolution, checks,
persistence and reporting, plus the pure authority-existence decision that maps
a lookup onto them; it defines none of the surrounding steps itself.

## Responsibility

`@obiter/verification-core` owns:

- a citation as it appears in a draft, and the normalized identity a check can
  act on;
- the verification subject (the immutable draft version under check) and draft
  locations (paragraph id plus UTF-16 offsets into the paragraph's plain-text
  projection, never text);
- evidence references that point at public legal source material by id at one
  of two granularities: the stored document itself, or an addressable paragraph
  or provision of it, so a finding rests on the kind of proof it actually has;
- finding identity, type, severity, confidence, and the conservative status
  model, including the explicit review-required state;
- the authority-existence decision (V2): a normalized citation and a lookup
  outcome to an accepted finding state. The store lookup itself stays in the
  API;
- the citation-resolution result model and decision (V3): a raw candidate to a
  canonical identity, or a reason it did not resolve, plus the pure decision
  that maps that onto the finding vocabulary. Reading the store stays in the
  API, and so does parsing.

## What the values hold

Evidence has two granularities, and they are not interchangeable:

- a **document reference** names a whole stored judgment or Act (its source id
  and nothing inside it). It proves the stored authority's identity and
  availability, which is exactly what a whole-authority existence finding
  claims, and it is the only form that works for a source whose paragraph or
  provision array is empty. It carries no location.
- a **fragment reference** names one paragraph (ordinal plus printed number) or
  one provision (label path). A quote, proposition or provision-specific
  finding needs a fragment, because the document alone cannot say where the
  supported text lives.

`finding.ts` enforces which granularity each finding type accepts: a quote check
needs a fragment, a whole-authority check needs the document, and a fragment may
never substitute for the document identity (or the reverse). A `sourceType` is
part of the union so both granularities stay anchored to the shared
`LegalSourceType` vocabulary and cannot cross source families.

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
- **Resolution hands V2 its own input.** A resolved V3 result carries the
  resolved arms of `NormalizedCitation`, so `normalizedCitationFromResolution`
  is the whole V3 to V2 boundary. Every other outcome maps to an `unresolved`
  or `not_checked` citation, which V2 can only skip, so a malformed, ambiguous,
  unresolved or inconclusive result cannot enter V2 as a resolved identity.
- **Evidence and source agree.** A clear or flagged finding must cite at least
  one evidence reference, and every reference must name the same public source as
  its resolved citation. Judgment and legislation references cannot cross.
- **Evidence granularity matches the finding type.** A whole-authority finding
  (case law, or a whole Act) rests on document-level evidence; a provision-level
  or quote-fidelity finding rests on a fragment. A fragment cannot stand in for
  the document identity, and the document cannot stand in for supported text.
- **Finding identity.** `createVerificationFindingId` is a deterministic
  idempotency key for one immutable version, check type and draft span, encoded
  with length-prefixed components so distinct inputs cannot collide on `:`.
  `verificationFindingSchema` accepts only that derivation, so an arbitrary
  string (or matter text) is not a valid finding id.

## Citation resolution (V3)

V3 answers one question: does this already-extracted citation candidate resolve
unambiguously to the canonical authority it purports to name? It turns one
candidate, or a batch of them, into the identity V2 accepts.

`CitationResolution` is the resolution layer's own result model, deliberately
separate from the finding vocabulary:

| outcome        | meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `resolved`     | exactly one canonical identity, in the resolved arms of `NormalizedCitation` |
| `unresolved`   | citation-shaped and inside the grammar, but no canonical identity matched    |
| `ambiguous`    | more than one canonical identity remains possible, and none wins             |
| `malformed`    | outside the accepted citation grammar                                        |
| `unsupported`  | a citation of a source family this layer does not resolve                    |
| `inconclusive` | an operational dependency failed, so resolution could not complete           |
| `not_checked`  | resolution did not run                                                       |

`decideCitationResolution` maps that onto a `citation_resolution` finding. Every
non-resolved outcome is review-required; none is a pass, and none is a claim
about whether an authority exists. `authority_not_held` is unreachable here
because the finding schema reserves it for the existence check, so the two
checks cannot be confused by construction.

Two invariants are worth stating because they are easy to get wrong:

- **Zero candidates is `unresolved`, not absence.** A citation that matches no
  stored record has no canonical identity to check. Reporting that as "not
  held" would decide V2's question from V3's evidence, and the store is partial.
- **A failed dependency is `inconclusive`, not absence.** Resolution reads
  Postgres, so it can be unavailable; a database outage must never be recorded
  as a citation that did not resolve.

V3 does not extract citations from a document, scan matter prose, use a search
rank as identity, compare quotations, classify proposition support, or decide
whether an authority is held. Free-text legislation recognition, title folding
and section and schedule parsing stay with the Search classifier V3 calls.
Extraction itself, and any route, worker or UI that runs resolution over a
draft, remain V5's wiring.

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
  recognises free-text legislation citations, and
  `packages/search-client` owns the judgment evidence id format
  (`<documentId>:judgment_paragraph:<ordinal>`) and the exact citation fold
  (`normalizeCitationValue`). This package does not parse free-text citations
  and does not query Meilisearch, Postgres or Atlas. V2 and V3 call those layers
  and hand the results to this vocabulary.
- **`packages/contracts` owns the citation grammars.** The canonical `/ln/`
  legislation path grammar and the neutral citation grammar live there, because
  each has two consumers that must agree: the app shell scans draft prose for
  neutral citations (`packages/app-shell/src/document-authorities.ts`) while V3
  validates a single already-extracted candidate against the same source, and
  the `/ln/` grammar is shared with the web route. Neither grammar is copied
  into this package or into the resolver.
- **V2 store boundary and V3 batching.** The V2 authority-existence lookup lives
  in `services/api/src/authority-existence.ts` and reads the public legal-source
  record through the existing Search store helpers. Provision resolution shares
  `resolveStoredProvisionPath` in
  `services/api/src/routes/legal-search/legislation-store.ts` with the serving
  path, so the single-schedule alias has one owner and a held provision cannot
  read as not-held to one caller and held to the other. The case-law candidate
  lookup is a batch
  (`findStoredAuthorityIdsByNeutralCitations`): its SQL pushes the citation year
  into the query and returns only the citation projection.
- **V3 resolution boundary.** `services/api/src/citation-resolution.ts` owns the
  store-backed resolution. It batches rather than looping: one candidate lookup
  covers every case-law citation in the call, one Act-directory read covers the
  free-text legislation candidates, and a canonical `/ln/` path needs no read at
  all because the identity is in the path. The Act title grammar, the title fold,
  the `(repealed)` handling, section and schedule parsing and the chapter
  identity all stay in the Search classifier it calls; a provision citation is
  resolved to an identity here and its existence is V2's question, so the
  single-schedule alias is still applied in exactly one place.
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
- source-version pinning for evidence. The fragment forms can repoint (a
  judgment paragraph by ordinal, a provision by label path); the document forms
  carry no location and so cannot. V5 owns any pinning before these become
  durable rows.

## Non-goals

Deliberately absent, and owned by later board items:

- citation extraction from a document, and any route, worker or UI that runs
  resolution over a draft (V5);
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
