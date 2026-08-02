# Search client

## Correctness benchmark

`pnpm benchmark:search` runs the fixed Gate 1 objective case set against a
Meilisearch 1.12 instance. The suite contains 50 synthetic queries covering
exact citations, malformed and ambiguous citations, titles, party names,
provider ids, body phrases, no-answer behavior, court and date filters, and
short-word precision.

Set `SEARCH_BENCHMARK_HOST` and `SEARCH_BENCHMARK_API_KEY` when the benchmark
server is not available at the local defaults. CI starts the pinned server,
runs the benchmark, fails on a metric regression, and uploads the JSON report.
Every case records its top three ids, any failure labels and search error messages.
`searchWallClockP95Ms` measures end-to-end client wall-clock time for successful
searches, while each case retains Meilisearch's `processingTimeMs` separately.
The 250 ms wall-clock P95 ceiling provides headroom over the observed 45 ms CI
P95 without treating the engine's rounded processing time as end-to-end latency.
Set `SEARCH_BENCHMARK_ALLOW_REGRESSION=1` to retain the report while disabling
its failure exit code, for local investigation only.

The date-filter cases `date-brown-from-1994`, `date-potanina-2024` and
`date-smith-before-2019` are currently expected to fail with `search_error`.
Meilisearch comparison operators accept numeric operands only, while the
current date filter emits a string date comparison. Fixing this requires a
numeric date timestamp field in the document schema and is tracked separately.

The fixture text is synthetic. Do not replace it with raw legal or client
matter text.
