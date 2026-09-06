#!/usr/bin/env bash
# Runs the same gates as .github/workflows/ci.yml, in the same order.
# Meilisearch must be reachable for the search benchmark; Postgres must be
# reachable and obiter_test migrated. If not, the script exits 1 and names
# the compose command.
set -euo pipefail

cd "$(dirname "$0")/.."

MEILI_KEY=search-benchmark-key
MEILI_HOST=http://127.0.0.1:7700
TEST_DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter_test
COMPOSE_CMD='docker compose -f infra/docker/compose.yaml up -d'

if ! curl -fsS "$MEILI_HOST/health" >/dev/null 2>&1; then
  echo "Meilisearch not reachable at $MEILI_HOST" >&2
  echo "Start it with: $COMPOSE_CMD" >&2
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
  echo "Recreate it from compose (image tag pinned in infra/docker/compose.yaml): docker compose -f infra/docker/compose.yaml up -d --force-recreate meilisearch" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found (required for Postgres checks)" >&2
  echo "Install with: sudo apt-get install postgresql-client" >&2
  exit 1
fi

if ! pg_isready -h localhost -p 5432 -U obiter -d obiter_test >/dev/null 2>&1; then
  echo "Postgres not reachable at $TEST_DATABASE_URL" >&2
  echo "Start it with: $COMPOSE_CMD" >&2
  exit 1
fi

# The test database must have every migration in packages/database/migrations
# recorded in schema_migrations (applied via `pnpm db:migrate`). Comparing the
# file list against the tracking table — rather than probing one hardcoded
# table — keeps this check correct as migrations are added.
if ! APPLIED=$(psql "$TEST_DATABASE_URL" -tAc "SELECT filename FROM public.schema_migrations ORDER BY filename" 2>/dev/null); then
  echo "Postgres database obiter_test has no schema_migrations table" >&2
  echo "Apply migrations with: pnpm db:migrate --database-url=\"$TEST_DATABASE_URL\"" >&2
  exit 1
fi
MISSING=$(comm -23 <(for f in packages/database/migrations/*.sql; do basename "$f"; done | sort) <(printf '%s\n' "$APPLIED" | sort) || true)
if [ -n "$MISSING" ]; then
  echo "Postgres database obiter_test is missing migrations:" >&2
  printf '%s\n' "$MISSING" | sed 's/^/  /' >&2
  echo "Apply them with: pnpm db:migrate --database-url=\"$TEST_DATABASE_URL\"" >&2
  exit 1
fi

# PDF glyph cover tests in services/api fail by fractions of a point when
# fontconfig or fonts-liberation are missing (pdf.js substitutes a system font
# for base-14 fonts and the cover geometry is measured against rendered ink).
# Rebuild the cache first: apt can finish before fontconfig has indexed the
# new faces, which is the same race CI hits without `fc-cache -f`.
# Use grep -c (counts, consumes all input) rather than grep -q: under
# set -o pipefail, grep -q closes the pipe early, fc-list dies of SIGPIPE
# (exit 141), and pipefail propagates 141 — so the check reports missing
# fonts on a machine that has them.
# Same pinned config as CI (FONTCONFIG_FILE in .github/workflows/ci.yml):
# pdf.js resolves base-14 fonts through fontconfig, so the mirror must resolve
# through the same file, not the developer's system config.
export FONTCONFIG_FILE="$PWD/.github/fontconfig-liberation.conf"
mkdir -p /tmp/obiter-fontconfig-cache
fc-cache -f >/dev/null 2>&1 || true
LIBERATION=$(fc-list 2>/dev/null | grep -ci liberation || true)
if ! command -v fc-list >/dev/null 2>&1 || [ "${LIBERATION:-0}" -eq 0 ]; then
  echo "Missing Liberation fonts (fontconfig / fonts-liberation)" >&2
  echo "Without them the PDF glyph cover tests in services/api fail by fractions of a point because" >&2
  echo "pdf.js substitutes a system font when rendering base-14 fonts. Install with:" >&2
  echo "  sudo apt-get install fontconfig fonts-liberation && sudo fc-cache -f" >&2
  exit 1
fi

echo "== install"      && pnpm install --frozen-lockfile
echo "== typecheck"    && pnpm typecheck
echo "== format:check" && pnpm format:check
echo "== lint"         && pnpm lint
echo "== test"         && TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm test

echo "== benchmark:search"
SEARCH_BENCHMARK_API_KEY="$MEILI_KEY" \
SEARCH_BENCHMARK_HOST="$MEILI_HOST" \
SEARCH_BENCHMARK_REPORT_PATH=/tmp/search-benchmark.json \
  pnpm benchmark:search

echo
echo "All gates passed."
