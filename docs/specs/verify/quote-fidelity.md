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
their straight forms. Nothing else is folded. Case is not folded because
capitalisation can be legally meaningful. Dashes are not folded because a hyphen
and an en/em dash are different marks. No punctuation, word, negation or number
is removed, so a punctuation or number difference is a substantive difference
rather than a silent pass. NFC is used rather than NFKC so fullwidth digits,
ligatures and other compatibility forms are not unified. The Search highlighting
normaliser is not reused: it lowercases and serves retrieval recall, not proof.

### What constitutes a proven mismatch

Only a unique anchored alignment produces a `flagged` mismatch:

- the quotation is not an exact or normalised substring of the source;
- exactly one contiguous source span has the quotation's first and last word,
  allowing at most one word more or fewer;
- the aligned span differs from the quotation.

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
issues no query for an empty batch. Request size and source fragment count and
size are bounded at that boundary before the pure comparison runs, so the
comparison is linear in the source and never an unbounded edit-distance or
quadratic scan over attacker-controlled text. A partial source failure makes
only the quotations that needed that source inconclusive.

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
