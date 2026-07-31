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
Every case records its top three ids and any failure labels.

The fixture text is synthetic. Do not replace it with raw legal or client
matter text.
