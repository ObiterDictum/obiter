# Verify Domain Model

Priority: `P3`

The vocabulary V1 established in `packages/verification-core`, recorded here so
the finding fields in `schema.md`, the routes in `api.md` and the UI in V5 do not
drift from it. The package is the source of truth for shapes; this document is
the source of truth for names and intent.

## Subject and locations

- `VerificationSubject` is `{ documentId, versionId }`, the immutable draft
  version under verification. A location is only meaningful against the version
  it was taken from, so a re-saved document is a different subject.
- `DraftLocation` is `{ paragraphId, start, end }`. `end` is exclusive and
  `end > start`; zero-length, reversed and negative spans are invalid. A
  location is an id plus offsets, never text, so a finding can be stored and
  rendered without carrying the matter it points at.
- Offsets are UTF-16 code units, the indices `String.prototype.slice` uses, into
  the paragraph's plain-text projection: `paragraphPlainText` plus extra runs, or
  the inserted text for a locally inserted paragraph. `extractAuthorities` in
  `packages/app-shell` is the producer convention V4 and V5 must slice the same
  way. They are not code points, bytes or OOXML positions, and runs, pages and
  sections are not part of a location.

## Citation

- `CitationInput` is `{ rawText, location }`: the citation string as it appears
  in the draft, and where it appears. `rawText` is the citation only, not the
  paragraph around it, and it is stored verbatim: it is the draft slice the
  location names, and the schema requires its UTF-16 length to equal
  `end - start`.
- `NormalizedCitation` is a discriminated union on `kind`, the citation state:
  - `case_law`: the canonical neutral citation string plus `sourceId`, the
    stored authority document id (`LegalAuthority.id`) that evidence also names.
    Splitting the string into court, year and number is citation resolution
    (V3), not normalisation. `sourceId` is what makes evidence linkage checkable;
    without it a case-law finding could not prove its evidence belongs to the
    citation.
  - `legislation`: `documentIdentity` plus `labelPath`, with `null` meaning the
    whole Act. The Act identity is the canonical `ukpga/YYYY/N` form and the
    label path is canonical `/`-separated segments (`section/40`); the schemas
    reject values the canonical grammar rejects, and additionally reject empty,
    `.`/`..` and percent-encoded segments.
  - `unresolved`: normalisation ran and could not produce an identity, with a
    `reason`: `not_a_citation` (outside the accepted grammar),
    `unsupported_source_type` (a citation of a family Verify does not resolve),
    `no_canonical_match` (citation-shaped and inside the grammar, but no
    canonical identity matched), `ambiguous` (more than one), or
    `resolution_unavailable` (resolution could not complete because a dependency
    failed). The last two exist because V3 can fail in ways the first two
    cannot express, and a store outage recorded as `no_canonical_match` would be
    a negative result the check never established.
  - `not_checked`: normalisation has not run. It is the only citation state that
    pairs with an unrun check.
- The one normalisation this layer owns is a canonical legislation path
  (`/ln/ukpga/2010/15/section/40`) to its source identity, delegating to the
  shared path grammar in `packages/contracts/src/legislation-paths.ts`. The
  `/ln/` prefix is required, because the shared grammar also accepts the bare
  form for `apps/web`'s `/ln/$` route.
- Free-text legislation citations (`s 6 HRA 1998`) are recognised by search in
  `services/api/src/routes/legal-search/legislation-citations.ts`. Case
  citations are recognised by the editor's regex in
  `packages/app-shell/src/document-authorities.ts`. Neither is reimplemented
  here.

## Evidence references

A reference points at public source material by id, at one of two
granularities. The granularity is the discriminator, so a document reference
and a fragment reference of the same source are different values and neither
carries the other's fields.

- `judgment` at `fragment`: `sourceId` (the authority document id), `ordinal`
  (1-based position in the paragraph array), and `paragraphNumber` (`null` when
  the judgment prints none, display only). The printed number and the position
  can differ for a block-quoted paragraph, so they are separate fields. Its
  stable id is `<sourceId>:judgment_paragraph:<ordinal>`, byte-identical to
  `createJudgmentParagraphEvidenceId` in `packages/search-client`.
- `judgment` at `document`: `sourceId` only. It names the stored judgment and
  nothing inside it, so it is the honest anchor for a whole-authority existence
  claim and the only anchor a judgment with no paragraphs can carry. Its stable
  id is `<sourceId>:judgment_document`.
- `legislation_provision` at `fragment`: `sourceId` (the Act identity,
  `ukpga/2010/15`) and `labelPath` (`section/40`). Its stable id is
  `<sourceId>:legislation_provision:<labelPath>`.
- `legislation_document` at `document`: `sourceId` (the Act identity). It names
  the stored Act and nothing inside it, so a whole-Act finding rests on the Act
  identity even when the Act holds no provisions. Its stable id is
  `<sourceId>:legislation_document`.

Granularity is enforced by finding type, not chosen by the caller: a
whole-authority `clear` or `flagged` finding must carry document-level evidence,
a `quote_fidelity` finding and any finding on a provision citation must carry a
fragment, and the two may not substitute for one another. A valid finding may
carry a fragment in addition to the document identity (the document is still
present), but not instead of it.

No reference holds source text or any matter content. Both forms are constrained
to canonical components that cannot contain `:`, because the shared
`search-client` judgment id format joins on it and cannot change. Evidence is not
source-version aware: a judgment ordinal or a legislation label path can repoint
if a source document is re-ingested, whereas the document forms carry no location
and therefore cannot. V5 owns any pinning before these become durable rows.

## Findings

`schema.md`'s `verification_findings` table persists these.

- `type`: `authority_existence`, `citation_resolution`, `quote_fidelity`.
  Proposition support (V8) adds a member.
- `severity` and `confidence`: `high`, `medium`, `low`, or `null` for a check
  that did not run. An unrun check has no outcome, so it fabricates neither.
- `status` is a discriminated union on `state`:
  - `clear`: the check ran and found nothing to flag.
  - `flagged`: the check ran and found a problem.
  - `not_checked`: the check did not run. It is not a pass, and it claims
    nothing.
  - `review_required`: the check could not conclude. A `reason` is mandatory.
- Review reasons: `citation_ambiguous`, `citation_unresolved`,
  `authority_not_held`, `evidence_unavailable`, `check_inconclusive`.
- `requiresReview` is true for `not_checked` and `review_required`, false for
  `clear` and `flagged`. An unrun or inconclusive check is unknown, not a pass.

### Accepted finding states

The schema admits exactly these combinations; anything else fails to parse.

| status            | reason                 | citation state                       | evidence                                |
| ----------------- | ---------------------- | ------------------------------------ | --------------------------------------- |
| `clear`           | -                      | resolved (case law or legislation)   | required granularity, naming the source |
| `flagged`         | -                      | resolved (case law or legislation)   | required granularity, naming the source |
| `review_required` | `citation_unresolved`  | `unresolved`                         | none                                    |
| `review_required` | `citation_ambiguous`   | `unresolved` with reason `ambiguous` | none                                    |
| `review_required` | `authority_not_held`   | resolved                             | none                                    |
| `review_required` | `evidence_unavailable` | resolved                             | none                                    |
| `review_required` | `check_inconclusive`   | resolved or unresolved               | none, or naming the resolved source     |
| `not_checked`     | -                      | `not_checked`                        | none                                    |

- `authority_not_held` remains review-required by construction and is only valid
  on an `authority_existence` finding: it names that check's verdict, and a check
  that merely cannot reach a source reports `evidence_unavailable` or
  `check_inconclusive`.
- The rule runs in both directions: a resolved citation cannot be paired with a
  citation-shaped reason, an unresolved citation cannot be `clear` or `flagged`
  (normalisation failure forces review), evidence cannot name a source other than
  the resolved citation, and duplicate references are refused.
- Evidence granularity is derived from the finding, not chosen by the caller: a
  case-law or whole-Act finding needs document-level evidence, a provision
  citation or `quote_fidelity` finding needs a fragment, and a fragment cannot
  stand in for the document identity (nor the document for supported text).
- Finding identity is
  `vf:<len>:<documentId>:<len>:<versionId>:<len>:<type>:<len>:<paragraphId>:<len>:<start>:<len>:<end>`,
  where `<len>` is the UTF-16 length of the component that follows. It is a
  deterministic idempotency key scoped to one immutable version, and it is also
  the identity V5 persists: it is not a per-run key, not a content hash, and
  collisions are impossible by the encoding. Because a re-run of the same version
  reproduces it, a findings table scoped by run must key on `(run_id, finding_id)`
  rather than treat this value as a per-run primary key. The normalized citation
  is excluded, so a later normaliser change does not re-key existing findings, and
  no citation text, quote, explanation, filename, matter name or user text enters
  it.

## Authority existence (V2)

V2 answers one question: does Obiter's stored public legal-source record hold a
trustworthy source for this normalized citation? It is not a claim that the
authority exists, is good law, or that the raw citation is correct. It reads
Postgres only and never writes.

### V2 / V3 boundary

- V3 owns parsing raw citation text into a `NormalizedCitation` (splitting a
  neutral citation, resolving free-text Act citations). V2 never sees prose.
- V2 owns checking that normalized identity against the stored substrate. It
  does not re-parse, re-normalize or correct the citation.
- Once V3 hands V2 a canonical label path, V2 resolves it with the same store
  semantics the serving path uses (`resolveStoredProvisionPath`), including the
  single-schedule alias. There is one owner of that alias, and a citation the
  Act page resolves cannot read as not-held to verification.

### Lookup outcomes

| store outcome                                  | finding status                             | evidence                                                                             |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| exactly one live match                         | `clear`                                    | document evidence for a whole authority, provision fragment for a provision citation |
| no match                                       | `review_required` / `authority_not_held`   | none                                                                                 |
| Act held, cited provision absent               | `review_required` / `authority_not_held`   | none                                                                                 |
| more than one live match                       | `review_required` / `check_inconclusive`   | none                                                                                 |
| store error (`store_error`)                    | `review_required` / `check_inconclusive`   | none                                                                                 |
| schema-invalid stored row (`malformed_record`) | `review_required` / `check_inconclusive`   | none                                                                                 |
| only match(es) withdrawn                       | `review_required` / `evidence_unavailable` | none                                                                                 |
| schedule citation with no schedule number      | `review_required` / `check_inconclusive`   | none                                                                                 |
| stored identity disagrees with the citation    | `review_required` / `check_inconclusive`   | none                                                                                 |
| citation unresolved / not checked              | `review_required` or `not_checked`         | none                                                                                 |

The `store_error`, `malformed_record`, `source_withdrawn`, `identity_mismatch`
and `citation_underspecified` categories are distinct so an operational caller
can tell a database outage from a corrupt row from invalid input without
reading the finding explanation. None of them is `authority_not_held`, and the
user-facing explanation never carries raw error text.

### Performance and batching

The case-law candidate lookup (`findStoredAuthorityIdsByNeutralCitations`) is a
batch: it pushes the citation year into SQL and returns only the citation
projection, and a caller with many citations issues one query for the year set.
V3 should call it once per document, not once per citation. An index is
deliberately not added: the year predicate is a `like` superset the exact
normalized comparison still filters, and the measured single-call path is
dominated by the sequential scan for either shape, so batching is the durable
fix. The store API accepts a normalized-citation array so V3 does not need a
redesign to batch.

### Payload text and boundary limits

`citation.rawText` is verbatim cited text and `explanation` is authored text;
both can carry matter. They are the only fields that can, and they are not
identifiers. This package sets no length or count limits: the API, queue and
persistence boundaries own input sizes, the check that `rawText` matches the
stored version's projection, and tenant scoping.

## Citation resolution (V3)

V3 answers one question: does this already-extracted citation candidate resolve
unambiguously to the canonical authority it purports to name? It turns one raw
candidate, or a batch of them, into the canonical identity V2 consumes, and it
is the only layer that turns raw text into a `NormalizedCitation`.

A raw citation candidate is an already-extracted string plus the caller's stable
identifier for it (for example a paragraph id and offsets). V3 does not extract
candidates from a document and does not scan matter prose: the app shell already
extracts, and V5 wires extraction to this layer. A canonical identity is a
resolved `NormalizedCitation`: a neutral citation with its stored judgment
`sourceId`, or a canonical Act identity with its structured label path.

### Result model

`CitationResolution` is V3's public outcome. It is deliberately larger than the
finding vocabulary, because the finding vocabulary has one axis (a citation state
plus a review reason) and resolution failures are not all the same failure.

| resolution outcome | V1 citation state                        | `citation_resolution` finding                 |
| ------------------ | ---------------------------------------- | --------------------------------------------- |
| `resolved`         | `case_law` or `legislation`              | `clear`, with the resolved source as evidence |
| `unresolved`       | `unresolved` / `no_canonical_match`      | `review_required` / `citation_unresolved`     |
| `ambiguous`        | `unresolved` / `ambiguous`               | `review_required` / `citation_ambiguous`      |
| `malformed`        | `unresolved` / `not_a_citation`          | `review_required` / `citation_unresolved`     |
| `unsupported`      | `unresolved` / `unsupported_source_type` | `review_required` / `citation_unresolved`     |
| `inconclusive`     | `unresolved` / `resolution_unavailable`  | `review_required` / `check_inconclusive`      |
| `not_checked`      | `not_checked`                            | `not_checked`                                 |

`normalizedCitationFromResolution` is the whole V3 to V2 boundary: it returns the
resolved identity for a `resolved` result and an `unresolved` or `not_checked`
citation for every other result. V2 can only skip those, so a malformed,
ambiguous, unresolved or inconclusive result cannot enter V2 as a resolved
identity, and the map throws nowhere a caller can quietly bypass it.

### Supported forms

- **Case law**: a whole candidate matching the shared neutral-citation grammar in
  `packages/contracts/src/neutral-citation.ts` (the same grammar draft extraction
  scans prose with), resolved by exact neutral-citation comparison. The documented
  folds may differ from the stored string: case, whitespace, punctuation and
  leading zeros in the number. Nothing beyond those folds is applied, so a
  fullwidth bracket, a fullwidth digit, a Unicode lookalike or a hidden control
  character is refused rather than folded into a match.
- **Legislation by canonical path**: `/ln/ukpga/YYYY/N[/label/path]`, resolved by
  the shared path grammar with no store read. A canonical-shaped path naming an
  act type this repository does not store is `unsupported`, not `malformed`.
- **Legislation by free text**: the forms the Search classifier recognises, namely
  short titles, chapter citations (`1998 c. 42`), the curated aliases, and
  section and schedule forms in either supported order, with the stored title
  fold (case, quote, hyphen and punctuation folding, `(repealed)` annotations).

### Case-law semantics

The canonical identity of a judgment citation is the stored document id, so a
case-law candidate takes one batch store read. Zero stored records carrying the
citation is `unresolved`, never a claim that the authority does not exist. Two or
more is `ambiguous`, and the withdrawn flag is deliberately not consulted:
choosing between duplicate carriers means reading their records and judging which
is trustworthy, which is V2's authority-existence decision. Resolution therefore
never picks a winner by row order, and a withdrawn record never silently beats a
live one. A single carrier resolves even when it is withdrawn; V2 then reports
`evidence_unavailable` for it.

### Legislation semantics

A chapter citation proves its own canonical identity (`1998 c. 42` is
`ukpga/1998/42`), so an unheld chapter still resolves and V2 reports the honest
`authority_not_held` for it. That is the negative protection delivered by #194
and #196 and it is preserved here. A title the stored directory cannot resolve
is `unresolved`, not absent: the directory is partial, so a failed title lookup
is not proof. A provision citation resolves to the Act identity plus the label
path the citation names; whether that provision is held is V2's question, so a
missing provision of a held Act is a resolution success followed by an existence
finding. The single-schedule alias stays in `resolveStoredProvisionPath`, which
V2 calls, and is not duplicated here.

### Batching ownership

`resolveCitationCandidates` in `services/api/src/citation-resolution.ts` is the
batch boundary, and it issues at most one candidate lookup for every case-law
citation in the call and one Act-directory read for the free-text legislation
candidates. A canonical `/ln/` path needs no read. Results are returned in input
order and echo each candidate's identifier, and a dependency that fails makes
only the candidates that needed it `inconclusive`, so a partial failure is
reported as a partial failure. No migration or index was added: the existing
batch query already pushes the citation year into SQL, so the document-level
cost is one round trip rather than one query per citation, which is why the
batch is the durable fix rather than a new index.

### Limitations and deferred work

- Resolution is wired to no route, worker or UI. V5 owns the run, the batching
  call site against a real document, and persistence.
- Secondary legislation and any non-`ukpga` act type are out of scope and resolve
  only as `unsupported` when they arrive as a canonical-shaped `/ln/` path. A
  free-text secondary citation is `malformed`, because no repository grammar
  recognises it.
- A case name without a neutral citation never resolves: there is no canonical
  mechanism that maps a party name to a neutral citation, so inventing one would
  be a guess.
- A resolved case-law identity carries the candidate's own spelling of the
  neutral citation, after the trim. Its durable identity is `sourceId`; the
  stored printed form is not re-read, and the documented folds are applied at
  comparison rather than written back into the string.
- A case-law citation is resolved from the store, so a store outage makes its
  resolution `inconclusive`. Legislation by canonical `/ln/` path is unaffected,
  because its identity is in the path.
- Meilisearch rank is never used as identity. Resolution reads Postgres only.

## Deliberately absent

- Claim support statuses (`supported`, `weak_support`, `contradicted`,
  `unsupported`, `not_checked`, `manual_review_required`) from
  `verification-evidence.md`. They classify how well evidence supports a claim,
  which V8 owns. The finding status `not_checked` is a different axis: it says a
  check did not run, not how a claim is supported.
- Verification run identity and lifecycle status, which the API and worker own.
