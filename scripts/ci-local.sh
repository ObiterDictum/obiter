#!/usr/bin/env bash
# Runs the same gates as .github/workflows/ci.yml, in the same order.
# Meilisearch must be reachable for the search benchmark; started if absent.
set -euo pipefail

cd "$(dirname "$0")/.."

MEILI_KEY=search-benchmark-key
MEILI_HOST=http://127.0.0.1:7700

if ! curl -fsS "$MEILI_HOST/health" >/dev/null 2>&1; then
  echo "Meilisearch not reachable at $MEILI_HOST" >&2
  echo "Start it with: docker start meili" >&2
  exit 1
fi

echo "== install"      && pnpm install --frozen-lockfile
echo "== typecheck"    && pnpm typecheck
echo "== format:check" && pnpm format:check
echo "== lint"         && pnpm lint
echo "== test"         && pnpm test

echo "== benchmark:search"
SEARCH_BENCHMARK_API_KEY="$MEILI_KEY" \
SEARCH_BENCHMARK_HOST="$MEILI_HOST" \
SEARCH_BENCHMARK_REPORT_PATH=/tmp/search-benchmark.json \
  pnpm benchmark:search

echo
echo "All gates passed."
