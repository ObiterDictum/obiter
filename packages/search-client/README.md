# Search client

## Correctness benchmark

`pnpm benchmark:search` runs the fixed Gate 1 objective case set against a
Meilisearch 1.12 instance. The suite contains 53 synthetic queries covering
exact citations, malformed and ambiguous citations, titles, party names,
provider ids, body phrases, no-answer behavior, court and date filters, and
short-word precision.

Set `SEARCH_BENCHMARK_HOST` and `SEARCH_BENCHMARK_API_KEY` when the benchmark
server is not available at the local defaults. CI starts the pinned server,
runs the benchmark, fails on a metric regression, and uploads the JSON report.
Every case records its top three ids, any failure labels and search error messages.
The raw provider error retained as an error cause is for internal diagnostics only,
and must never be serialised into an API response or user-facing log.
`searchWallClockP95Ms` measures end-to-end client wall-clock time for successful
searches, while each case retains Meilisearch's `processingTimeMs` separately.
The 250 ms wall-clock P95 ceiling provides headroom over the observed 45 ms CI
P95 without treating the engine's rounded processing time as end-to-end latency.
Set `SEARCH_BENCHMARK_ALLOW_REGRESSION=1` to retain the report while disabling
its failure exit code, for local investigation only. Set
`SEARCH_BENCHMARK_REPORT_PATH` to write the JSON report to a file. Benchmark
minimums are ratcheted floors set to observed behaviour and tightened only by
the PR that improves the corresponding metric.

## Search settings

The index keeps legal content words searchable and removes only function words.
Court codes remain searchable through `neutralCitation`; the benchmark covers
`UKSC`, `EWCA Civ`, and `Admin`. Court display names are not indexed because
no display-name field exists in the source schema.

Search uses Meilisearch's `all` matching strategy by default, so every query
term must match. Callers that prefer recall can set
`LegalSearchOptions.matchingStrategy` to `frequency`. The default 0.5 ranking
score threshold is skipped for an empty-query filtered browse. Callers can
lower it or set `LegalSearchOptions.rankingScoreThreshold` to `null` to disable
it when recall is more important.

Updating searchable attributes or stop words causes Meilisearch to re-index the
existing index. Environments must allow that task to finish before relying on
the revised settings.

### Known latency observation

The CI Meilisearch container shows a bimodal 40.579 ms adder in the provider-call
span. Meilisearch reports 0 ms execution time and client-side processing is below
0.703 ms. A seeded second pass found the same 21 slow query ids at different
ordinal positions, so the observation is request-content dependent rather than
an artefact of the benchmark's fixed order. The first shuffled request was slow
at 43.57 ms and the second was fast after the same connection had served fifty
requests, ruling out connection warm-up: the wall-clock P95 gate measures
steady-state latency rather than a cold-connection artefact. It has not been
reproduced outside that CI container and may not apply to the real deployment
topology.

Malformed citations are split between recoverable forms, which assert the
correct authority, and unresolvable forms, which assert no results.

The date-filter cases `date-brown-from-1994`, `date-potanina-2024` and
`date-smith-before-2019` are currently expected to fail with `search_error`.
Meilisearch comparison operators accept numeric operands only, while the
current date filter emits a string date comparison. Fixing this requires a
numeric date timestamp field in the document schema and is tracked separately.

The fixture text is synthetic. Do not replace it with raw legal or client
matter text.
