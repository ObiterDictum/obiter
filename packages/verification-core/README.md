# Verification core

Pure domain vocabulary for Verify. No storage, no network, no provider calls, no
UI. It defines the values Verify passes between extraction, resolution, checks,
persistence and reporting, plus the pure decisions (authority existence,
citation resolution, quote fidelity) that map an outcome onto them; it defines
none of the surrounding steps itself.

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
  API, and so does parsing;
- the quote-fidelity comparison (V4): the permitted typographic folds, the
  bounded anchored comparison of a quotation against stored source fragments,
  and the decision that maps a match, a proven mismatch or an inconclusive
  comparison onto a `quote_fidelity` finding.

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
text payloads are not, by design. For a `quote_fidelity` finding the `citation`
field carries the **quotation** rather than the citation token: V1 keys
`createVerificationFindingId` on that field's location, and a quotation's
identity must be its own draft span, not the citation's, or two quotations
attributed to one citation occurrence would collide. `normalizedCitation` still
carries the authority the quotation is attributed to.
`docs/specs/verify/domain-model.md` records the accepted finding states, and
`docs/specs/verification-evidence.md` sanctions showing bounded citation text to
a reviewer.

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

| outcome        | meaning                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolved`     | exactly one canonical identity, in the resolved arms of `NormalizedCitation`                                                                                                                                |
| `unresolved`   | citation-shaped and inside the grammar, but no canonical identity matched                                                                                                                                   |
| `ambiguous`    | more than one canonical identity remains possible, and none wins                                                                                                                                            |
| `malformed`    | outside the accepted citation grammar                                                                                                                                                                       |
| `unsupported`  | a citation of a source family this layer does not resolve: a canonical-shaped `/ln/` path naming an unheld act type, or a well-formed neutral citation for a court outside the shared grammar's closed list |
| `inconclusive` | an operational dependency failed, so resolution could not complete                                                                                                                                          |
| `not_checked`  | resolution did not run                                                                                                                                                                                      |

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

## Quote fidelity (V4)

V4 answers one question: does the quoted passage appear in the resolved
authority as quoted? It consumes an immutable `VerificationSubject`, the
quotation's exact draft text and `DraftLocation`, the citation identity V3
resolved, and the stored fragments of a source V2 judged trustworthy. It
answers nothing else: it extracts no quotation, resolves no citation, decides
no heldness, compares no proposition, and never treats an inability to compare
as a mismatch.

Two pure functions make the check testable without a store:

- `compareQuoteText(quote, fragmentTexts)` compares one quotation against
  already-retrieved fragment texts. It returns `match` (with exact versus
  normalised), `mismatch` (with the kind of difference), or an inconclusive
  outcome (`no_fragments`, `empty_quote`, `no_match`, `ambiguous`, `elided`).
- `prepareQuoteSource(fragmentTexts)` plus
  `compareQuoteTextAgainstPrepared(quote, source)` are the same comparison with
  the source's normalisation and tokenisation done once, for a caller comparing
  many quotations against one authority.
- `compareQuote`/`decideQuoteFidelity` add the citation and source-readiness
  vocabulary and produce the finding. `QuoteComparison` is the comparison's own
  result model, deliberately separate from the finding vocabulary.
- `quoteSpanViolation`/`QuoteSpanInvalidError` are the one owner of the
  quotation-span contract: a blank quotation and a quotation that is not the
  draft slice its location names are refusals, not comparison outcomes, because
  V1's `citationInputSchema` cannot carry a blank `rawText` in the finding's
  `citation` field.

### Normalisation policy

The permitted folds are explicit, deterministic and applied to both sides:
Unicode NFC; CRLF/CR to LF; any Unicode whitespace run to one space, trimmed;
soft hyphen removed; the ellipsis character to three periods; curly quotation
marks and apostrophes to their straight forms. The apostrophe set is owned in
one place (`APOSTROPHE_FOLDS`) and is the ASCII apostrophe, U+2018, U+2019,
U+201A, U+201B, U+2032, U+02BC and U+FF07; U+02BB (the `okina`, a letter),
U+02B9 (a transliteration prime) and U+2039/U+203A (single guillemets) are
deliberately not apostrophes here. Nothing else is folded. Case is
not folded (capitalisation can be legally meaningful), dashes are not folded
(hyphen and en/em dash are different marks), and no punctuation, word, negation
or number is removed. NFC is used rather than NFKC so fullwidth digits and
ligatures are not silently unified. The Search highlighting normaliser
(`normalizeExactMatchValue`) is deliberately not reused: it lowercases and its
purpose is retrieval recall, not proof.

### Word boundaries

A quotation only matches where it stands as whole words: an occurrence is
rejected when a word-character edge of the quotation is glued to a word
character of the source. `he court must consider`, `the point` inside
`the points were argued`, and `act` inside `exact` therefore do not clear, and a
later whole-word occurrence wins over an earlier clipped one. Punctuation edges
have nothing to glue to, so quotations inside `(parentheses)` or `"quotation
marks"` and quotations that begin or end with punctuation are unaffected. The
word class is Unicode letters, numbers and combining marks. An apostrophe mark
touching a word character is part of that word, so `court's`, `courts'` and
`don't` are each one word and a quotation stopping inside one is a partial-word
match; the same apostrophe set drives the folds and the boundary test.
Emptiness is decided from the quotation before any source is consulted, so a
blank or fold-empty quotation is never a match and never carries evidence.

### What a mismatch means

Only a unique anchored alignment produces a mismatch: the comparison finds a
single contiguous source span whose first and last word equal the quotation's,
allowing at most one word more or fewer, and that span differs from the
quotation. Zero candidate spans, more than one, a larger edit, an unmatched
ellipsis or a quotation that is merely absent all return an inconclusive
result. No nearest-neighbour, first-fragment or similarity score is used, and a
similarity score never chooses a status. A mismatch is a positive claim and
always carries the fragment that shows it.

### Evidence

A `quote_fidelity` finding rests on fragment evidence: a judgment paragraph
(`sourceId`, `ordinal`, printed `paragraphNumber`) or a legislation provision
(`sourceId`, stored `labelPath`). The fragments must belong to the resolved
citation's own source; a fragment from another source or family is a
`QuoteSourceMismatchError`, a programmer error rather than a finding. A
legislation quote is scoped to exactly one provision, so matching text from
another provision can never verify it, and the fragment must be the provision
the citation resolved to: the `ready` source outcome carries the canonical
identity the single owner of citation resolution returned, so the
single-schedule alias maps onto its stored path without this package
re-implementing the alias. Multiple fragments for a cross-fragment
match are deduplicated and ordered.

### Cross-fragment support

A case-law quotation spanning contiguous stored paragraphs is matched across
the normalised join and names every paragraph it touches. A quotation spanning
non-contiguous paragraphs, or a legislation quotation that would span more than
the resolved provision, is inconclusive (`passage_not_located` or a source
reason), never a mismatch. Paragraph-number prefixes are not folded away,
because removing a number is exactly the kind of change the check exists to
catch.

### Failure outcomes

- `match` maps to `clear` with fragment evidence, confidence high when the
  match is exact and medium when a permitted fold produced it.
- a proven `mismatch` maps to `flagged` with fragment evidence, severity high.
- an unavailable, ambiguous or unaddressable comparison maps to
  `review_required` (`evidence_unavailable` for a source that is absent,
  withdrawn, unverified or has no fragment; `check_inconclusive` for a store
  failure, a malformed record, an identity mismatch or an unlocated or
  ambiguous passage).
- a check that did not run maps to `not_checked`.

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
  (`findStoredAuthorityCarriersByNeutralCitations`): its SQL pushes the citation
  year into the query and returns only the citation projection and the provider
  block. One pure rule, `selectAuthorityCarriers`, turns a carrier set into its
  live/withdrawn disposition, and both V2 and V3 read it, so the two stages
  cannot drift on the same store state. A case-law citation for a court outside
  the shared grammar's closed list is `unsupported` and takes no store read at
  all.
- **V3 resolution boundary.** `services/api/src/citation-resolution.ts` owns the
  store-backed resolution. It batches rather than looping: one candidate lookup
  covers every case-law citation in the call, one Act-directory read covers the
  free-text legislation candidates, and a canonical `/ln/` path needs no read at
  all because the identity is in the path. The Act title grammar, the title fold,
  the `(repealed)` handling, section and schedule parsing and the chapter
  identity all stay in the Search classifier it calls; a provision citation is
  resolved to an identity here and its existence is V2's question, so the
  single-schedule alias is still applied in exactly one place.
- **V4 retrieval boundary.** `services/api/src/quote-fidelity.ts` owns the
  store-scoped fragment read. It is scoped to the resolved citation (one
  judgment document, or the one provision the citation names), reuses
  `createPostgresLegalAuthoritySourceStore` for judgments and
  `resolveStoredProvisionPath` for legislation so the single-schedule alias has
  one owner, refuses provision text that is not a verified current version, and
  batches: `checkQuoteFidelities` reads each distinct source once for any
  number of quotations from it, prepares that source's comparison
  representation once (`prepareQuoteSource`), and issues no query for an empty
  batch. It enforces the request-size, source-size and batch-size bounds the
  pure package does not set, and returns one outcome per request in input
  order, so a candidate it cannot check (`quote_blank`, `quote_span_mismatch`,
  `quote_too_large`, `source_identity_conflict`) is a rejected entry beside its
  siblings' findings rather than a thrown error that would discard them. A
  batch larger than `maxQuoteFidelityBatchSize` is a caller contract violation
  and is refused before any read; V5 chunks accordingly.
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
  length). For a quote-fidelity finding the same rule applies to the quotation;
  V5 owns reading it from the stored version;
- the request-size and source-size bounds the V4 service applies before the
  pure comparison runs.
- tenant/organisation/matter scoping and authorisation;
- source-version pinning for evidence. The fragment forms can repoint (a
  judgment paragraph by ordinal, a provision by label path); the document forms
  carry no location and so cannot. V5 owns any pinning before these become
  durable rows.

## Non-goals

Deliberately absent, and owned by later board items:

- citation extraction from a document, and any route, worker or UI that runs
  resolution or quote checking over a draft (V5);
- findings UI (V5);
- verification artifact export (V6);
- proposition extraction and claim support classification (V7, V8);
- extended findings UI (V9);
- persistence, queues, routes, React and provider calls.

Claim support statuses (`supported`, `weak_support`, `contradicted`,
`unsupported`, `not_checked`, `manual_review_required`) from
`docs/specs/verification-evidence.md` are also deliberately absent: they classify
claim support, not check outcomes, and V8 owns them.
