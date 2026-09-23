# Verify Implementation

## Scope

- citation extraction
- authority resolution via Atlas
- quote fidelity checks
- proposition support checks
- structured findings and report generation

## Build Steps

1. implement citation extraction pipeline
2. connect Atlas resolution and evidence lookup
3. implement quote matching
4. implement proposition extraction and support scoring
5. persist findings and render findings UI

## Status

V1 (#199), V2 (#202), V3 (#204) and V4 (#206) are delivered as domain and store
machinery. V5 wires those checks to an immutable document version: it extracts
citations and quotations from the stored model, runs V3 then V2 then V4,
persists `verification_runs` / `verification_findings`, and renders findings in
the shared app shell. Execution is request-scoped in this slice (no BullMQ
worker). Report export remains V6.

Model loading (package inflate, XML parse, model schema validation) runs on a
bounded in-process worker pool (`document-model-pool.ts`) rather than on the
serving event loop, because one medium document held the loop for about four
seconds and timed out concurrent stored searches into false 503s. The pool runs
at most two workers, queues nothing, and is terminated inside both entry
points' existing drain; every other part of the run stays request-scoped.

## Extraction coverage

V5 traverses every in-scope legal drafting story: the main document, footnotes
and endnotes, in that fixed order. Paragraph ids are only unique inside their
story, so each location carries its `storyKind` and `storyPartName` and the V1
finding id includes them. Headers, footers and comments are deliberately out of
scope until a product decision says otherwise; the run panel states the
coverage rather than implying the whole document was checked, and
`extractVerificationCandidates` reports the traversed and skipped story kinds.

## Legislation tokens

A `/ln/ukpga/...` citation is one lexically bounded token: every non-whitespace
character after the prefix. At most one documented trailing prose punctuation
character is removed, and only when the remainder parses; repeated punctuation
stays in the token. The whole token must parse under the canonical
`packages/contracts` path grammar, and there is no shrink-until-a-prefix-parses
loop. A token that does not parse is passed to V3 verbatim and comes back
`citation_unresolved`, never rewritten into a different Act, chapter or
provision.

## Quote association

A quotation is compared only when exactly one citation association is
defensible within its own paragraph and story: a citation wholly before or
wholly after it, and no second candidate on either side. Several candidates on
one side, candidates on both sides, or one citation that several quotations
would claim all yield `ambiguous`, which becomes a `citation_ambiguous`
review-required finding. V5 associates candidates only; it never re-resolves a
citation or reimplements the V4 comparison.

## Run recovery

A live run holds a ten-minute lease (`lease_expires_at`) fenced by
`lease_token`. The executor renews at explicit boundaries (after the model read
and before each quote-fidelity batch), never on an interval. A POST against a
run whose lease is live returns that run; a POST against a `running` run whose
lease expired interrupts it (monotonic transition to `failed`,
`failure_code = 'interrupted'`, findings deleted) and creates one replacement
under the same `FOR UPDATE` row lock, so concurrent POSTs cannot create several.
A reclaimed executor's completion matches no row and writes nothing. The lease
comfortably exceeds request-scoped work, which is bounded to 500 citations and
500 quotations in 200-item batches.

## Stack

- Node.js
- TypeScript
- BullMQ
- PostgreSQL
- shared `packages/verification-core`

## Safety Rules

- classify uncertain checks as review required
- do not overclaim legal correctness
