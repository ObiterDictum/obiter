#!/usr/bin/env bash
# Runs the same gates as .github/workflows/ci.yml, in the same order.
# Meilisearch must be reachable for the search benchmark; if not, the script
# exits 1 and tells you how to start it.
set -euo pipefail

cd "$(dirname "$0")/.."

MEILI_KEY=search-benchmark-key
MEILI_HOST=http://127.0.0.1:7700

if ! curl -fsS "$MEILI_HOST/health" >/dev/null 2>&1; then
  echo "Meilisearch not reachable at $MEILI_HOST" >&2
  echo "Start it with: docker start meili" >&2
  exit 1
fi

# Verify the running Meilisearch matches the version pinned in ci.yml.
# GET / on Meilisearch is the dashboard; the version lives at /version and
# requires the master key. Parse the pinned tag from ci.yml so the version
# is not hardcoded in two places.
PINNED_IMAGE=$(grep -oE 'getmeili/meilisearch:v[0-9.]+' .github/workflows/ci.yml | head -n1 || true)
PINNED_VERSION=${PINNED_IMAGE##*:}
PINNED_VERSION=${PINNED_VERSION#v}
if [ -z "$PINNED_VERSION" ]; then
  echo "Could not parse pinned Meilisearch version from .github/workflows/ci.yml" >&2
  exit 1
fi
RUNNING_VERSION=$(curl -fsS -H "Authorization: Bearer $MEILI_KEY" "$MEILI_HOST/version" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('pkgVersion',''))" 2>/dev/null || true)
if [ -z "$RUNNING_VERSION" ]; then
  echo "Could not determine running Meilisearch version from $MEILI_HOST/version" >&2
  echo "Expected $PINNED_VERSION (from $PINNED_IMAGE in .github/workflows/ci.yml)" >&2
  exit 1
fi
if [ "$RUNNING_VERSION" != "$PINNED_VERSION" ]; then
  echo "Meilisearch version mismatch: running $RUNNING_VERSION but ci.yml pins $PINNED_VERSION ($PINNED_IMAGE)" >&2
  echo "Restart with the pinned image: docker rm -f meili; docker run -d --name meili -p 7700:7700 -e MEILI_MASTER_KEY=$MEILI_KEY -e MEILI_NO_ANALYTICS=true $PINNED_IMAGE" >&2
  exit 1
fi

# PDF glyph cover tests in services/api fail by fractions of a point when
# fontconfig or fonts-liberation are missing (pdf.js substitutes a system font
# for base-14 fonts and the cover geometry is measured against rendered ink).
# Use grep -c (counts, consumes all input) rather than grep -q: under
# set -o pipefail, grep -q closes the pipe early, fc-list dies of SIGPIPE
# (exit 141), and pipefail propagates 141 — so the check reports missing
# fonts on a machine that has them.
LIBERATION=$(fc-list 2>/dev/null | grep -ci liberation || true)
if ! command -v fc-list >/dev/null 2>&1 || [ "${LIBERATION:-0}" -eq 0 ]; then
  echo "Missing Liberation fonts (fontconfig / fonts-liberation)" >&2
  echo "Without them the PDF glyph cover tests in services/api fail by fractions of a point because" >&2
  echo "pdf.js substitutes a system font when rendering base-14 fonts. Install with:" >&2
  echo "  sudo apt-get install fontconfig fonts-liberation" >&2
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
