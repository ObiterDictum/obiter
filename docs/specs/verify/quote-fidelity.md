# Verify Quote Fidelity (V4)

Priority: `P3`

The quote-fidelity check: the pipeline boundary, the strict input model, the
normalisation and mismatch policy, fragment evidence, cross-fragment support,
failure outcomes, performance and the V5 wiring boundary. `domain-model.md`
links here and owns the shared finding and evidence vocabulary V4 consumes.

V4 answers one question: does the quoted passage appear in the resolved
authority as quoted? It consumes an immutable `VerificationSubject`, the
quotation's exact draft text and `DraftLocation`, the citation identity V3
resolved, and the stored fragments of a source V2 judged trustworthy. It
produces a `quote_fidelity` finding using V1's finding and fragment-evidence
model.

The pipeline boundary is fixed:

```text
raw draft quotation
-> V3 resolved citation
-> V2 trustworthy stored authority
-> V4 quote comparison against stored fragments
-> V1 quote_fidelity finding + evidence
-> V5 execution, persistence and UI
```

V4 does not extract citations or quotations from a document, resolve citations,
decide heldness, use Meilisearch rank as proof, classify proposition support,
decide whether an authority is good law, persist a finding, expose a route,
worker or UI, or call an external model. It never treats an inability to compare
as a mismatch.

### V1-V4 boundaries

- V1 owns the finding, status and evidence vocabulary and the `quote_fidelity`
  type. V4 adds no new public status vocabulary; a comparison maps onto V1's
  accepted states.
- V2 owns whether a trustworthy stored source is held. V4 reads the same public
  source record, scoped to the identity V3 already resolved, and re-applies the
  same trust conditions (held, live rather than withdrawn, schema-valid, and
  naming the resolved identity) before it compares. It cannot compare against a
  source V2 would refuse, and it does not re-decide heldness. Its one additional
  condition is that stored provision text must be a verified current version,
  because a difference against amended or unchecked text would not be a
  trustworthy mismatch.
- V3 owns raw citation to canonical identity. V4 consumes the resolved arm and
  never re-parses a citation; V3's carrier selection is the only place the
  resolved source id is chosen.
- V4 owns the comparison only: does the quotation appear in that source as
  quoted?

### V4 input model

The input distinguishes the quotation from the citation it is attributed to:

- an immutable `VerificationSubject` (`documentId`, `versionId`);
- the quotation as `{ rawText, location }`: the exact draft slice and its
  half-open UTF-16 `DraftLocation`, with `rawText.length === end - start` and no
  surrounding paragraph text;
- the `NormalizedCitation` V3 resolved (the resolved arm only; an unresolved or
  unrun citation has no source to compare against);
- a `QuoteSourceOutcome` from the store boundary: the trustworthy fragments of
  the resolved source, or the reason none could be used.

A resolved citation is required for a comparison. An unresolved or ambiguous
citation, or any source that is absent, withdrawn, malformed, unreadable,
size-bounded out, whole-Act rather than provision-scoped, or whose provision
text is not a verified current version, is `review_required` and never a
mismatch. A whole-document evidence reference cannot satisfy a quote check, and
a fragment cannot be invented for a source with no addressable text.

### Quote normalisation policy

The permitted folds are explicit, deterministic and applied to both sides:
Unicode NFC; CRLF/CR to LF; any Unicode whitespace run (including NBSP, tabs,
line breaks and the Ogham space) to one space, trimmed; soft hyphen removed; the
ellipsis character to three periods; curly quotation marks and apostrophes to
their straight forms. The apostrophe set is owned in one place
(`APOSTROPHE_FOLDS` in `packages/verification-core/src/quote-text.ts`) and is the
ASCII apostrophe, U+2018, U+2019, U+201A, U+201B, U+2032, U+02BC (modifier
letter apostrophe) and U+FF07 (fullwidth apostrophe); the word-boundary model
below reads the same set. Deliberately excluded: U+02BB (the `okina`, a letter
in several orthographies), U+02B9 (a transliteration prime) and U+2039/U+203A
(single guillemets, the single partners of the double guillemets this policy
does not fold). Nothing else is folded. Case is not folded because
capitalisation can be legally meaningful. Dashes are not folded because a hyphen
and an en/em dash are different marks. No punctuation, word, negation or number
is removed, so a punctuation or number difference is a substantive difference
rather than a silent pass. NFC is used rather than NFKC so fullwidth digits,
ligatures and other compatibility forms are not unified. The Search highlighting
normaliser is not reused: it lowercases and serves retrieval recall, not proof.

### Word-boundary model

A quotation only matches where it stands as whole words. An occurrence is
accepted only when a word-character edge of the quotation is not glued to a word
character of the source:

- a quotation that begins or ends inside a longer word does not match, so
  `he court must consider` does not clear inside `the court must consider the
point`, `the point` does not clear inside `the points were argued`, and `act`
  does not clear inside `exact`;
- a valid occurrence later in the source wins over an earlier clipped one;
- a quotation whose edge is punctuation, whitespace or a bracket has nothing to
  glue to, so a quotation taken from inside `(parentheses)` or from inside
  `"quotation marks"` still clears, and a quotation that begins or ends with
  punctuation is unaffected.

The word class is Unicode letters, numbers and combining marks. NFC runs first,
so a composed and a decomposed word compare equal, and a combining mark that
survives NFC belongs to the word it modifies rather than starting a new one.

An apostrophe mark that touches a word character is part of that word, so
`court's`, `courts'` and `don't` are each one word and a quotation that stops
inside one is a partial-word match rather than a clear. Because the threshold
reads the same apostrophe set as the folds, `court's`, `court’s` and `courtʼs`
bound identically. One documented consequence: a passage quoted from inside
single quotation marks in the source is inconclusive rather than clear, because
the mark touches a word and the comparison does not guess whether it opens a
quotation. Double quotation marks are unaffected.

### What constitutes a proven mismatch

Only a unique anchored alignment produces a `flagged` mismatch:

- the quotation is not an exact or normalised occurrence of the source at a
  word boundary (see "Word-boundary model")
- exactly one contiguous source span has the quotation's first and last word,
  allowing at most one word more or fewer;
- the aligned span differs from the quotation.

A quotation that exists in the source only inside a longer word falls through to
this comparison like any other non-match; it ordinarily becomes
`passage_not_located` (`review_required`), and only becomes `flagged` when that
comparison proves a unique corresponding passage.

The difference is classified as a punctuation, reorder, substitution, omission
or insertion, and the finding carries the fragment that shows it. Zero candidate
spans (`passage_not_located`), more than one (`passage_ambiguous`), a larger
edit, a reordered span the anchors cannot establish, or an ellipsis the source
does not contain (`quote_elided`) all return `review_required`, never `flagged`.
No nearest-neighbour, arbitrary first-fragment or similarity-score matching is
used, and a similarity score never decides a status.

### Fragment evidence requirements

A `quote_fidelity` finding rests on fragment evidence:

- case law: `sourceId` (the judgment document id), 1-based `ordinal`, and the
  printed `paragraphNumber` where the stored record has one;
- legislation: the canonical Act identity and the stored provision `labelPath`.

Every fragment must belong to the resolved citation's own source; a fragment
from another source or another family is a programmer error
(`QuoteSourceMismatchError`), not a finding. A legislation quote is scoped to
exactly one provision, so matching text from another provision cannot verify a
provision citation. Multiple fragments for a cross-fragment match are
ordered and deduplicated, and source text never enters an evidence identity.

A legislation fragment must also be the provision the citation resolved to, not
merely a provision of the same Act. The `ready` source outcome carries the
canonical identity the single owner of citation resolution returned, and the
comparison refuses a fragment that is not that provision. The canonical stored
path is compared, never the citation's own label path, so the single-schedule
alias maps onto its stored path without V4 re-implementing the alias. A boundary
that contradicts the citation it resolved fails closed and never clears or flags
by the wrong provision.

### Empty and blank quotations

Where a quotation carries no comparable text, the comparison never reports a
match and never produces fragment evidence:

- A quotation that is non-blank but reduces to nothing under the permitted folds
  (soft hyphens, or whitespace the folds collapse) is a representable finding:
  `empty_quote`, `review_required` / `check_inconclusive`.
- A blank quotation — empty, or nothing but whitespace after trimming — has no
  representable finding, because V1's `citationInputSchema` refuses a blank
  `rawText` and a finding records the quotation in its `citation` field. The
  store boundary refuses it as a rejected candidate (`quote_blank`) before any
  source is read. `quoteSpanViolation` in `packages/verification-core` is the one
  owner of that contract, and `decideQuoteFidelity` raises the typed
  `QuoteSpanInvalidError` rather than a schema error if a caller bypasses it.

Emptiness is decided from the quotation alone, before any source is consulted,
so it takes precedence over an absent source.

### Cross-fragment support

A case-law quotation spanning contiguous stored paragraphs is matched across the
normalised join and names every paragraph it touches. A quotation spanning
non-contiguous paragraphs, or a legislation quotation that would need more than
the resolved provision, is inconclusive rather than a mismatch. Paragraph-number
prefixes are not folded away, because removing a number is exactly the kind of
change the check exists to catch; a quotation that includes one returns
`review_required`.

### Failure outcomes

| comparison result                          | finding status                                                    | evidence    |
| ------------------------------------------ | ----------------------------------------------------------------- | ----------- |
| exact match                                | `clear` (confidence high)                                         | fragment(s) |
| normalised match                           | `clear` (confidence medium)                                       | fragment(s) |
| proven material mismatch                   | `flagged` (severity high)                                         | fragment(s) |
| passage not located or ambiguous, ellipsis | `review_required` / `check_inconclusive`                          | none        |
| source absent, withdrawn or unverified     | `review_required` / `evidence_unavailable`                        | none        |
| citation unresolved or ambiguous           | `review_required` / `citation_unresolved` or `citation_ambiguous` | none        |
| check did not run                          | `not_checked`                                                     | none        |

Severity and confidence are fixed per outcome; no similarity number chooses
them.

### Performance and batching ownership

`services/api/src/quote-fidelity.ts` owns retrieval and batching. It is scoped
to the resolved citation (one judgment document, or the one provision lineage),
reads each distinct source once for any number of quotations from it, and
prepares that source's comparison representation once
(`prepareQuoteSource`), so a document of many quotations pays one read, one
normalisation and one tokenisation rather than one per quotation. The prepared
representation is keyed by the resolved source identity, carries the fragment
count it was built from, and is checked against the fragments it is used with,
so it cannot carry one source's text behind another source's indexes. Request
size, source fragment count and size are bounded at that boundary before the
pure comparison runs, so the comparison is linear in the source and never an
unbounded edit-distance or quadratic scan over attacker-controlled text.

One call accepts at most `maxQuoteFidelityBatchSize` (200) candidates. A larger
batch is a caller-level contract violation and is refused before any read; V5
chunks a document's quotations into batches of at most that size and
concatenates the results, which is why results come back one per request in
input order. A candidate the boundary cannot check does not fail the call: it
comes back as a rejected entry (`quote_blank`, `quote_span_mismatch`,
`quote_too_large`, or `source_identity_conflict` for a store that contradicts
the citation it resolved) beside its siblings' findings. A partial source
failure makes only the quotations that needed that source inconclusive.

### V5 wiring boundary

V4 is deliberately unwired. V5 owns running the check against a real document,
extracting quotations and their draft spans, matching each quotation to its
citation, persisting findings, and rendering them. No route, worker, queue or UI
is added here.

### Privacy treatment of raw quote text

The quotation's `rawText` is a payload field, never an identifier. It is not
placed in a finding id, an evidence id, a log line, a SQL identifier, a query
parameter or audit metadata. Store reads use ids only; a mismatch explanation
states the difference without reproducing the quotation or the source, and
failure diagnostics carry an error message only.
