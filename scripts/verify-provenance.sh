#!/usr/bin/env bash
# Verify that running dev servers provably serve this checkout.
#
# Two verification rounds measured code that did not contain the fix: a web
# dev server kept serving an older checkout, and an API/web pair ran from
# different checkouts and looked like a product bug. Screenshots of those
# stale builds were persuasive false claims. This script resolves where each
# server loads its code from and compares it against the checkout it is run
# from, failing closed when it cannot.
#
# Usage: scripts/verify-provenance.sh [web-origin] [api-origin]
#   defaults: http://localhost:3000 http://localhost:8787
#
# Exit 0 only when the web dev server provably serves this checkout. Exit 1
# when it serves a different checkout, or when its provenance cannot be
# determined. The API reports provenance when determinable and says so
# honestly when not (it currently exposes no checkout marker over HTTP, so
# the report is "not determinable"); API provenance never influences the
# exit code because unprovable is the normal, honest state for it.
set -euo pipefail

web_origin=${1:-http://localhost:3000}
api_origin=${2:-http://localhost:8787}

cd "$(dirname "$0")/.."

current_root=$(git rev-parse --show-toplevel)
current_sha=$(git rev-parse HEAD)
current_branch=$(git rev-parse --abbrev-ref HEAD)

# ---- web: where does the dev server load modules from? ---------------------
# Vite embeds the absolute filesystem path of out-of-root imports in every
# served module, as /@fs/<path> URLs and bare /<path> strings. The longest
# common path of those is the checkout the server was started in — no
# guessing, that is where Vite reads files from.
web_module=''
web_body=''
for candidate in /src/routes/index.tsx /src/routes/__root.tsx; do
  if web_body=$(curl -fsS -m 5 "$web_origin$candidate" 2>/dev/null); then
    web_module=$candidate
    break
  fi
done

web_root=''
web_matches='no'
if [ -z "$web_module" ]; then
  web_note="no Vite module served at $web_origin/src/routes/{index,__root}.tsx — is the web dev server running?"
else
  # Absolute paths embedded in the module: /@fs URLs first, else bare
  # filesystem paths that live under apps/web (bare matches must include the
  # leading segments so the common prefix is not truncated to /sargassum/...).
  paths=$(printf '%s\n' "$web_body" \
    | grep -oE '/@fs/[^?]*' | sed 's:^/@fs::' \
    || true)
  if [ -z "$paths" ]; then
    paths=$(printf '%s\n' "$web_body" \
      | grep -oE '/[^"'"'"')?]*/apps/web/[^"'"'"')?]*' \
      || true)
  fi

  if [ -z "$paths" ]; then
    web_note='served module contains no absolute filesystem paths — not a Vite dev server?'
  else
    # Longest common directory of all embedded paths.
    first=''
    while IFS= read -r line; do
      if [ -z "$first" ]; then
        first=$line
        continue
      fi
      n=0
      while [ "$n" -lt ${#first} ] && [ "$n" -lt ${#line} ] \
        && [ "${first:n:1}" = "${line:n:1}" ]; do
        n=$((n + 1))
      done
      first=${first:0:n}
    done <<EOF
$paths
EOF
    while [ -n "$first" ] && [ "${first: -1}" != '/' ]; do
      first=${first%?}
    done

    # Climb up until the common path is inside a git working tree.
    dir=$first
    while [ -n "$dir" ] && [ "$dir" != '/' ]; do
      if web_root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null); then
        break
      fi
      dir=$(dirname "$dir")
    done

    if [ -z "$web_root" ]; then
      web_note='embedded paths resolve to no git working tree — server not running from a checkout?'
    elif [ "$web_root" = "$current_root" ]; then
      web_matches='yes'
      web_note=''
    else
      web_note="serves a different checkout: $web_root"
    fi
  fi
fi

# ---- api: probe and report, never guess ------------------------------------
api_reachable='no'
api_note=''
if api_body=$(curl -fsS -m 5 "$api_origin/api/health" 2>/dev/null); then
  api_reachable='yes'
  case "$api_body" in
    *'"service":"obiter-api"'*)
      api_note='reachable, but exposes no checkout marker in HTTP responses — API provenance not determinable'
      ;;
    *)
      api_note="reachable, but response does not look like this stack's /api/health"
      ;;
  esac
else
  api_note="unreachable at $api_origin/api/health — is the API running?"
fi

# ---- report -----------------------------------------------------------------
web_pass='FAIL'
[ "$web_matches" = 'yes' ] && web_pass='PASS'

echo '== provenance check ============================='
echo "run from checkout : $current_root"
echo "commit            : $current_sha ($current_branch)"
echo
echo "web  $web_origin"
if [ -n "$web_module" ]; then
  echo "  module probed   : $web_module"
fi
if [ -n "$web_root" ]; then
  echo "  served from     : $web_root"
fi
echo "  matches checkout : $web_matches  [$web_pass]"
if [ -n "$web_note" ]; then
  echo "  note            : $web_note"
fi
echo
echo "api  $api_origin"
echo "  reachable       : $api_reachable"
echo "  provenance      : $api_note"
echo
echo 'PR evidence block (paste into the PR body) ======'
echo "Verified on $current_sha"
if [ -n "$web_root" ]; then
  echo "served: $web_root"
fi
echo "[screenshot]  (web provenance: $web_pass)"
echo '=================================================='

[ "$web_matches" = 'yes' ]