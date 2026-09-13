# Verify Domain Model

Priority: `P3`

The vocabulary V1 established in `packages/verification-core`, recorded here so
the finding fields in `schema.md`, the routes in `api.md` and the UI in V5 do not
drift from it. The package is the source of truth for shapes; this document is
the source of truth for names and intent.

## Subject and locations

- `VerificationSubject` is `{ documentId, versionId }`, the immutable draft
  version under verification.
- `DraftLocation` is `{ paragraphId, start, end }`. `end` is exclusive. A
  location is an id plus offsets, never text, so a finding can be stored and
  rendered without carrying the matter it points at.

## Citation

- `CitationInput` is `{ rawText, location }`: the citation string as it appears
  in the draft, and where it appears. `rawText` is the citation only, not the
  paragraph around it.
- `NormalizedCitation` is a discriminated union on `kind`:
  - `case_law`: the canonical neutral citation string. Splitting it into court,
    year and number is citation resolution (V3), not normalisation.
  - `legislation`: `documentIdentity` plus `labelPath`, with `null` meaning the
    whole Act.
  - `unresolved`: a `reason` of `not_a_citation`, `ambiguous` or
    `unsupported_source_type`.
- The one normalisation this layer owns is a canonical legislation path
  (`/ln/ukpga/2010/15/section/40`) to its source identity, delegating to the
  shared path grammar in `packages/contracts/src/legislation-paths.ts`.
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

No reference holds source text or any matter content.

## Findings

`schema.md`'s `verification_findings` table persists these.

- `type`: `authority_existence`, `citation_resolution`, `quote_fidelity`.
  Proposition support (V8) adds a member.
- `severity` and `confidence`: `high`, `medium`, `low`.
- `status` is a discriminated union on `state`:
  - `clear`: the check ran and found nothing to flag.
  - `flagged`: the check ran and found a problem.
  - `not_checked`: the check did not run. It is not a pass.
  - `review_required`: the check could not conclude. A `reason` is mandatory.
- Review reasons: `citation_ambiguous`, `citation_unresolved`,
  `authority_not_held`, `evidence_unavailable`, `check_inconclusive`.
- `requiresReview` is true for `not_checked` and `review_required`, false for
  `clear` and `flagged`. An unrun or inconclusive check is unknown, not a pass.
- A `clear` finding must carry at least one evidence reference and must not rest
  on an `unresolved` citation. A check cannot silently pass without evidence.
- Finding identity is
  `vf:<documentId>:<versionId>:<type>:<paragraphId>:<start>-<end>`, stable across
  re-runs so findings are idempotent. The normalized citation is excluded, so a
  later normaliser change does not re-key existing findings.

## Deliberately absent

- Claim support statuses (`supported`, `weak_support`, `contradicted`,
  `unsupported`, `not_checked`, `manual_review_required`) from
  `verification-evidence.md`. They classify how well evidence supports a claim,
  which V8 owns. The finding status `not_checked` is a different axis: it says a
  check did not run, not how a claim is supported.
- Verification run identity and lifecycle status, which the API and worker own.
