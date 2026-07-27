# Search PRD

Status: active. Supersedes [Search Quality](search-quality.md), which covered judgment search quality up to Gate 1 and predates the Find Case Law licence.

Scope: UK judgments, end to end. Legislation is deliberately excluded and gets its own PRD; see [Non-Goals](#non-goals).

## Summary

Search is Obiter's trust substrate. Verify, Research and Bench are all downstream of it: if retrieval is wrong, every system above it inherits the error and presents it with more confidence than it deserves.

This PRD replaces the previous one for three reasons. The Find Case Law licence is now executed, which unblocks holding a full corpus rather than fetching opportunistically. Search has a correctness defect, not merely a tuning gap, which the previous document did not identify. And the architecture has drifted into two search engines and three homes for search logic, which makes both of the above harder to fix.

The target is a lexical judgment search product that holds its own corpus, explains every result, fails visibly, and is measured against a fixed benchmark rather than an opinion.

## Settled Decisions

Recorded here so they are not relitigated in implementation.

| Decision               | Choice                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| Retrieval model        | Lexical only. Semantic and vector retrieval are out of scope entirely.         |
| Query layer            | Meilisearch, sole.                                                             |
| System of record       | PostgreSQL.                                                                    |
| Postgres tsvector tier | Retired once the benchmark validates parity or better.                         |
| Corpus                 | Full Find Case Law ingest from the start.                                      |
| Additional providers   | BAILII and others later, each requiring its own licence assessment.            |
| Source families        | Judgments only.                                                                |
| Serving                | Everything from Obiter's own store. No provider calls in the request path.     |
| Freshness              | Newly handed-down judgments searchable within the hour.                        |
| Deduplication          | One result per judgment. Find Case Law canonical.                              |
| Source identity        | Neutral citation, falling back to court + date + parties, collisions reviewed. |
| Failure posture        | Visible degraded state to users, full diagnostics internally.                  |
| Latency                | Sub-100ms suggestions, ~300ms p95 full search.                                 |
| Benchmark              | Start at ~50 queries, grow from observed failures.                             |
| Coverage reporting     | Internal until full Find Case Law ingest completes, then public.               |
| Reviewer mode          | Role on the existing auth model, enforced server-side.                         |
| Public API             | Later. Internal contract specified here.                                       |

## Users

In priority order.

**Obiter itself.** Verify, Research and Bench consume retrieval before any external user does. Their needs are stable evidence ids, deterministic results and honest failure signals rather than UX polish.

**Academic reviewers.** Inspect methodology, coverage, ranking rules and benchmark results. Their needs are transparency and reproducibility: a documented ranking model, a published benchmark, and the ability to see why a result appeared.

**Practising lawyers.** Find known authorities, search legal text, inspect paragraphs, check provenance. Their needs are exactness, speed and trustworthy negative results.

Public API and tool consumers are explicitly later. The internal API contract is specified in this document because app-shell, Verify and Research all consume it now and should not each invent a shape.

## Principles

- Exact legal identifiers outrank everything. No amount of body-text similarity beats a matching neutral citation.
- Search answers from Obiter's own store. Providers are acquisition pipelines, never request-path dependencies.
- A result must be able to explain itself: which query class matched, which retrieval path served it, which text supports it.
- Failures are visible. A lawyer who sees no results must be able to trust that means no results.
- Every stored record carries its licence provenance. Multi-provider corpora make this mandatory, not optional.
- Matching is a correctness property before it is a ranking property.
- Quality claims require a benchmark. Unmeasured relevance changes are not complete.

## Non-Goals

- Semantic or vector retrieval, embeddings over judgment text, and any model training or fine-tuning on judgments. These require the computational-analysis licence, which has not been applied for. If wanted later, that is a separate PRD with the licence as a hard dependency. The product consequence is accepted: natural-language question queries will not work well, because lexical matching cannot bridge question phrasing to the paragraph answering it.
- Legislation, statutory instruments and provision-level retrieval. Separate PRD. Legislation needs version, commencement and `asAtDate` modelling that must not be forced through the judgment shape.
- Public `/api/v1/legal/*` routes, SDK and MCP readiness.
- Research answer generation and Verify proposition support.
- Live provider fallback as user-facing behaviour.
- Matter-aware or private-document search. Public legal-source indexes must never contain private matter data.

## The Correctness Defect

This is the highest-priority item and was not identified in the previous PRD, which framed ranking as needing improvement.

Matching in `packages/search-client` is substring-based. Every comparison asks whether text _contains a sequence of characters_ rather than whether it contains a _word_. Because `"contested".includes("test")` is true, a search for `test` matches contested, testimony, testator, intestate, protest and latest. In case law that vocabulary is near-ubiquitous, so a short query matches most of the corpus.

Measured on a six-document fixture corpus, the query `test` returned five documents where one was correct: **precision 0.20**.

Meilisearch contributes independently by prefix-matching the trailing query term, so the engine returns `testimony` documents before the ranking layer runs. The two must be fixed together: correcting only the ranking layer means those documents are still returned but now produce no snippet, which presents as a result with no explanation.

Requirements:

- Query terms match on word boundaries, tolerating adjacent punctuation so `testator` matches `testator's` and `incrimination` matches `self-incrimination`.
- Boundary handling is Unicode-aware, so accented party names behave.
- A precision floor is enforced by the benchmark and regressions fail the build.

## Corpus And Acquisition

### Ingest

Full Find Case Law ingest from the start, across all courts and the full available date range. Acquisition runs as a background pipeline, never in the request path.

The pipeline must provide: resumable ingest that survives interruption without restarting; refresh driven by provider content hash so unchanged documents are not reprocessed; per-document parser confidence; explicit skipped-document reporting with reasons; and provider outage and rate-limit handling that degrades the pipeline rather than the product.

Accepting full ingest from the start means parser and relevance defects surface at full scale. Mitigation is the benchmark and coverage reporting, both of which must exist before the ingest campaign rather than after it.

### Freshness

New judgments searchable within the hour, via scheduled polling of the Find Case Law feed. Freshness lag is a monitored metric, not an assumption.

### Source identity

Neutral citation is the identity key where one exists. It does not always exist: neutral citations date from 2001, so every judgment older than that needs another key, and identity drives both deduplication and canonical URLs.

The strategy is hybrid:

- Neutral citation when present.
- Otherwise a composite of court, decision date and normalised party names.
- Candidate collisions on the composite key are held in a review queue rather than merged or split automatically. Same-court, same-day judgments with similar party names are exactly the case where guessing produces a wrong merge that is hard to detect later.

The review queue is deliberately lightweight while Find Case Law is the only provider, because duplicates within one provider are rare. It exists from the start because canonical URLs for pre-2001 judgments need a stable key regardless of how many providers there are.

### Multiple providers

Find Case Law is the only provider for now, and depth on it comes before breadth. Deduplication, cross-provider licence tracking and canonical-source resolution stay largely theoretical until a real second source exists, and getting one provider completely right is worth more than partial coverage of two.

When a second provider is added, most likely BAILII for its pre-2001 coverage, it requires its own licence assessment before any pipeline work. BAILII's terms on systematic copying are materially more restrictive than the Find Case Law position and must be confirmed first, not assumed.

The design accommodates this without building it: deduplication resolves to one result per judgment with Find Case Law canonical, since it is the official source with the most stable identifiers. Other providers become alternate sources on the detail page and the fallback where Find Case Law lacks a judgment. Provenance for every copy held is retained regardless of which is canonical.

## Licence And Provenance

Licence class exists nowhere in the code today. The only trace is a hardcoded string in a React view. That is insufficient for a single provider and untenable for several.

Requirements:

- Every stored source record carries provider, licence class, acquisition timestamp and official source URL, recorded at acquisition.
- Licence provenance is set by the acquisition layer, which is the single chokepoint through which provider data enters the system.
- The system can answer, in code, whether a given record may enter a given use. The immediate use of this is enforcing that no judgment text reaches a machine-learning path while only the transactional licence is held.
- Attribution requirements are satisfied from record data, not hardcoded per view.
- Retrofitting provenance onto an ingested corpus is materially harder than recording it at acquisition, so this lands **before** the ingest campaign.

## Retrieval And Ranking

### Query classification

Classify before retrieving. Classes: exact neutral citation, provider document id, case title, party names, phrase query, general keyword query, filter-only browse, and malformed or ambiguous.

The original query is preserved for display and audit; classification produces normalised lookup forms alongside it. Classification runs on submitted queries only, never on partial input, because a fragment such as `[2024] UKS` cannot be classified.

### Retrieval order

1. Exact document id and neutral citation lookup.
2. Title, alias and party-name lookup.
3. Paragraph-level phrase lookup.
4. Lexical keyword search over stored metadata and body text.

No stage may be skipped silently, and the stage that served a result is recorded on it.

### Ranking

Ordering: exact document id, exact neutral citation, exact title, title or party alias, paragraph phrase match, all-term body match, any-term body match. Recency is a tie-breaker only, never a primary signal.

Meilisearch's own relevance score is used as the ranking signal, with exact-match logic applied as a boost and tie-breaker on top. The current implementation re-sorts results on a four-value bucket score and discards the engine's ranking entirely, which must not continue.

### Index configuration

The index is currently untuned: no stopwords, no typo-tolerance configuration, no matching strategy, no score threshold.

- Matching strategy set so that surplus terms in long queries are dropped by frequency, retaining distinctive terms. The default drops trailing terms, which discards the most specific part of a query.
- Legal stopwords configured.
- Typo tolerance configured deliberately by word length; short terms should not tolerate typos.
- A ranking score threshold to cut the weak tail.
- Searchable attributes reviewed. `court` and `jurisdiction` are currently searchable, so a query such as `england` matches every English judgment.

Every setting change is justified by a benchmark delta, not by expectation.

## Performance

| Surface          | Target      | Notes                                                          |
| ---------------- | ----------- | -------------------------------------------------------------- |
| Suggestions      | p95 < 100ms | As-you-type over title, neutral citation and party names only. |
| Full search      | p95 < 300ms | On submit. Classification, exact lookup and lexical search.    |
| Ingest freshness | < 1 hour    | New judgment to searchable.                                    |

Two surfaces rather than one, because search-as-you-type over the full corpus is both expensive and unclassifiable. The suggestion layer serves the "find the case I already know" job over a narrow field set; the full pipeline runs on submit.

Targets are measured at full corpus size and under realistic concurrency. Targets measured on a sample corpus are not evidence.

## Failure And Degradation

Stored search failures and timeouts are currently swallowed. This contradicts the repository's stated principle that legal-critical failures must be visible rather than hidden behind quiet fallbacks, and it is dangerous in a legal product: a user cannot distinguish "no authority exists" from "search broke".

- Users see an explicit degraded or unavailable state. Never an empty result set standing in for a failure.
- Internal and reviewer mode sees full diagnostics: which stage failed, timeout detail, index health, ingest lag.
- Removing the Postgres fallback tier means Meilisearch availability is search availability. Resilience comes from redundancy in Meilisearch, whose index is rebuildable from PostgreSQL at any time, not from a differently-ranked second engine.
- Distinct, visible states for: no match, ambiguous query, malformed query, not yet indexed, and search degraded.

## Evidence

Aligned with the Evidence Unit model in [Verification Evidence](verification-evidence.md). Result and snippet payloads carry or reference: `evidence_id`, `source_id`, `source_type`, `source_title`, `display_citation`, canonical Obiter URL, official source URL, `provider`, `licence`, `location_type`, `location_ref`, `excerpt_ref`, `match_reason`, `retrieval_path`, `retrieval_rank`, `retrieval_score`, and ambiguity flags.

Snippets are bounded and tied to evidence ids. Result lists never return full documents.

## Internal API Contract

Not public, but stable enough that app-shell, Verify and Research consume one shape rather than three. Types live in `packages/contracts`.

- Search accepts query, filters (court, jurisdiction, date range), pagination cursor, result limit, and an evidence-metadata toggle.
- Suggestions is a separate, narrower operation over title, citation and party names.
- Document retrieval by id, and evidence retrieval for a document.
- Citation resolution, returning candidates rather than silently choosing when ambiguous.
- Responses default to stored sources, always. No provider fallback path exists to expose.
- Errors are typed and stable: validation, not found, ambiguous, index unavailable, degraded.
- No provider internals, admin search keys, raw provider payloads or database access cross this boundary.

## Module Boundaries

Search logic currently lives in three places: a route directory in `services/api` holding the provider client and parsers, a package holding ranking, and UI components. The provider integration, which the licence now makes central, sits at the architectural standing of a controller.

Target separation, within the existing monorepo:

- **Acquisition**: provider clients, parsers, rate limiting, retry, and licence provenance. The single chokepoint for provider data entering the system, and the one place to audit against the licence.
- **Search core**: indexing, query classification, ranking, evidence derivation. Knows nothing about where documents came from.
- **API**: thin routes exposing the above.
- **UI**: consumes `packages/contracts`.

Acquisition must not depend on search core, and search core must not depend on acquisition. The boundary is what makes the licence question answerable in one place.

## Quality And Benchmark

No relevance change ships without a benchmark delta.

**Objective cases**, verifiable without legal judgment: exact citation lookup, malformed citation, ambiguous citation, case title, party names, provider document id, body-text phrase, no-answer query, court-filtered browse, date-filtered query, and the short-word precision cases that expose substring matching.

**Legal-judgment cases**, requiring Karl's ruling: whether conceptually adjacent authorities should surface for a subject query, and how later-reversed decisions should rank.

The set starts at roughly 50 queries, sized to cover every query class rather than to look impressive, and grows from observed failures. A query that returns a bad result in real use becomes a benchmark case, so the set converges on the queries that actually break rather than the ones imagined up front. This means benchmark size is a lagging indicator of usage, and a small set early is expected rather than a gap.

Metrics: top-1 and top-3 exact source success, precision on the short-word set, evidence unit recall, no-answer precision, ambiguity surfaced, stored search latency at p95, and freshness lag.

The benchmark runs in CI. Regressions fail the build rather than producing a report nobody reads.

## Coverage

Tracked rigorously, surfaced internally only at first. Coverage by court and date range, ingest status, parser confidence distribution, skipped documents with reasons, and freshness lag.

Coverage becomes public when the full Find Case Law ingest completes. At that point the corpus matches what the provider holds, so remaining gaps are the provider's rather than Obiter's, and publishing them is a statement about the source rather than an admission about the product. Until then, publishing would advertise gaps that are being actively closed.

This is a trigger, not an aspiration: the coverage view is built during Gate 3 alongside the ingest campaign, and made public on its completion rather than being a later project.

## UX

**Search**: suggestion dropdown on typing; full search on submit; court, jurisdiction and date filters with active filter chips; result count; keyboard navigation; and distinct empty states for each failure class above.

**Result cards**: title, citation, court, date; match reason and bounded snippets with paragraph labels; provenance and licence; evidence count; warning flags for ambiguity, missing full text or low parser confidence.

**Detail**: paragraph viewer, search within source, jump to paragraph, copy citation, canonical Obiter link, official source link, indexed status.

**Reviewer mode**: normalised query, query class, retrieval path, filters applied, rank, score, index health, ingest lag.

Gated by a `reviewer` role on the existing auth model, extending the `owner`/`admin`/`member` roles already in `services/api/src/authz.ts`. A role rather than an internal build, because academic credibility depends on a reviewer running their own query against real data; an environment-gated build cannot offer that without handing over the build. A role is also grantable to a named individual, revocable, and auditable.

Diagnostics are excluded **server-side**, at response construction. Computing them and hiding them in the UI puts them in the payload, where anyone with developer tools can read them. The role check belongs in the API, not the component.

Reviewer mode exposes derived diagnostics over public legal sources only. It never exposes private matter data, search admin keys, provider credentials or database access, which remain prohibited irrespective of role.

## Security And Compliance

- Private matter data never enters public legal-source indexes.
- Meilisearch admin keys, database access and provider credentials are never exposed to models, SDKs or tools.
- Raw prompts containing private matter facts are not logged in search.
- Hosted data stays in the EU.
- Object keys contain no client names, matter names, original filenames or raw legal text.
- Source licence and computational-analysis permissions are respected per record, enforced at the acquisition boundary.

## Rollout

**Gate 1: Correctness.** Word-boundary matching, index tuning, Meilisearch score used rather than discarded, benchmark harness with the objective case set running in CI.
_Exit:_ precision on the short-word set is 1.0; exact citations and document ids rank first; benchmark runs record top-k and failure labels.

**Gate 2: Provenance and boundaries.** Licence provenance on source records, acquisition and search-core separation, internal API contract in `packages/contracts`.
_Exit:_ every stored record carries provider and licence; the licence question is answerable in code; no provider client is reachable from the ranking layer.

**Gate 3: Corpus.** Full Find Case Law ingest, hourly refresh, coverage reporting, parser confidence, skipped-document reporting.
_Exit:_ search no longer depends on user-triggered hydration; provider calls are absent from the request path; coverage and freshness are visible internally.

**Gate 4: Performance and resilience.** Suggestion layer, latency targets met at full corpus, Postgres tsvector retired, visible degradation states.
_Exit:_ p95 targets met under realistic concurrency; degraded states shown rather than swallowed; one query layer remains.

Gates 1 and 2 are ordered deliberately: provenance precedes the ingest campaign in Gate 3 because retrofitting it is materially harder.

## Risks

- Full ingest from the start surfaces parser and relevance defects at maximum scale. The benchmark and coverage reporting must precede the campaign, not follow it.
- Retiring the Postgres tier makes Meilisearch a single point of failure. Redundancy must land alongside retirement, not after.
- Ranking changes that improve keyword search can silently harm exact lookup. This is precisely what the benchmark exists to catch.
- Lexical-only retrieval will disappoint anyone expecting natural-language question answering. Positioning must be honest about what the product does.
- The composite identity key can wrongly merge same-court, same-day judgments with similar party names. The review queue is the control, and it only works if someone actually works it.
- A benchmark that grows from observed failures is small early, which is the point, but it means the first ingest campaign runs against thinner coverage than later work will enjoy.
- Depth-before-breadth on Find Case Law leaves pre-2001 coverage weak for longer, since that is where BAILII would have contributed most.

## Open Questions

None blocking. The five questions this PRD opened with are resolved in [Settled Decisions](#settled-decisions).

Deferred, to be answered when the work reaches them:

- Who owns the identity review queue operationally, once it has volume.
- Whether the `reviewer` role needs further hardening before any external academic is granted it.
- BAILII's licence position, to be confirmed before any second-provider work begins rather than at planning time.
