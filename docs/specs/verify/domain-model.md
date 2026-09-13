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
    `reason` of `not_a_citation`, `ambiguous` or `unsupported_source_type`.
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

A reference points at public source material by id:

- `judgment`: `sourceId` (the authority document id), `ordinal` (1-based
  position in the paragraph array), and `paragraphNumber` (`null` when the
  judgment prints none, display only). The printed number and the position can
  differ for a block-quoted paragraph, so they are separate fields. Its stable
  id is `<sourceId>:judgment_paragraph:<ordinal>`, byte-identical to
  `createJudgmentParagraphEvidenceId` in `packages/search-client`.
- `legislation_provision`: `sourceId` (the Act identity, `ukpga/2010/15`) and
  `labelPath` (`section/40`). Its stable id is
  `<sourceId>:legislation_provision:<labelPath>`.

No reference holds source text or any matter content. Both forms are constrained
to canonical components that cannot contain `:`, because the shared
`search-client` judgment id format joins on it and cannot change. Evidence is not
source-version aware: an ordinal repoints if a source document is re-ingested,
and V5 owns any pinning before these become durable rows.

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
| `clear`           | -                      | resolved (case law or legislation)   | one or more, naming the resolved source |
| `flagged`         | -                      | resolved (case law or legislation)   | one or more, naming the resolved source |
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

### Payload text and boundary limits

`citation.rawText` is verbatim cited text and `explanation` is authored text;
both can carry matter. They are the only fields that can, and they are not
identifiers. This package sets no length or count limits: the API, queue and
persistence boundaries own input sizes, the check that `rawText` matches the
stored version's projection, and tenant scoping.

## Deliberately absent

- Claim support statuses (`supported`, `weak_support`, `contradicted`,
  `unsupported`, `not_checked`, `manual_review_required`) from
  `verification-evidence.md`. They classify how well evidence supports a claim,
  which V8 owns. The finding status `not_checked` is a different axis: it says a
  check did not run, not how a claim is supported.
- Verification run identity and lifecycle status, which the API and worker own.
