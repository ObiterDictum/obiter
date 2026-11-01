#!/usr/bin/env bash
# Runs the same public gates as .github/workflows/ci.yml, in the same order.
# The API, the search benchmark, the database migrations and the end-to-end
# suite run from the private backend repository, whose own mirror covers them.
set -euo pipefail

cd "$(dirname "$0")/.."

# PDF glyph cover tests in services/redaction-renderer fail by fractions of a
# point when fontconfig or fonts-liberation are missing (pdf.js substitutes a
# system font for base-14 fonts and the cover geometry is measured against
# rendered ink).
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
  echo "Without them the PDF glyph cover tests in services/redaction-renderer fail by fractions of a point because" >&2
  echo "pdf.js substitutes a system font when rendering base-14 fonts. Install with:" >&2
  echo "  sudo apt-get install fontconfig fonts-liberation && sudo fc-cache -f" >&2
  exit 1
fi

echo "== install"      && bun install --frozen-lockfile
echo "== typecheck"    && bun --bun run typecheck
echo "== format:check" && bun --bun run format:check
echo "== lint"         && bun --bun run lint
echo "== build:web"    && bun --bun run --filter @obiter/web build
echo "== bundle:budget" && bun --bun run perf:bundle-budget
echo "== build:provenance" && bun apps/web/build-provenance.mjs verify --allow-dirty
echo "== build:desktop"  && bun --bun run --filter @obiter/desktop build
echo "== desktop:budget" && bun --bun run perf:desktop-budget
# The redaction-renderer suite launches the Playwright Chromium it ships
# against; `playwright install` is a fast no-op when the pinned revision is
# already in ~/.cache/ms-playwright and downloads it otherwise.
echo "== playwright:chromium" && bun --bun playwright install chromium
echo "== test"         && bun run test

echo
echo "All gates passed."
