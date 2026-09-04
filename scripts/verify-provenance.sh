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
# Usage: scripts/verify-provenance.sh [web-origin] [api-origin] [--expect marker]
#   defaults: http://localhost:3000 http://localhost:8787
#
# Exit 0 only when the web dev server provably serves this checkout and, when
# requested, the served module contains the expected marker. Exit 1 when it
# serves a different checkout, its provenance cannot be determined, or the
# marker is absent. API checkout mismatches also fail; absent API provenance
# does not, because production and older servers do not expose it.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/verify-provenance.sh [web-origin] [api-origin] [--expect marker]

Defaults:
  web-origin  http://localhost:3000
  api-origin  http://localhost:8787

--expect marker  require the literal marker in the served web module to check
                 revision freshness as well as checkout path
EOF
}

web_origin='http://localhost:3000'
api_origin='http://localhost:8787'
expected_marker=''
expected_marker_given='no'
positionals=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --expect)
      if [ "$#" -lt 2 ]; then
        echo 'error: --expect requires a marker' >&2
        usage >&2
        exit 2
      fi
      expected_marker=$2
      expected_marker_given='yes'
      shift 2
      ;;
    --expect=*)
      expected_marker=${1#--expect=}
      expected_marker_given='yes'
      shift
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      positionals+=("$1")
      shift
      ;;
  esac
done

if [ "${#positionals[@]}" -gt 2 ]; then
  echo 'error: expected at most web-origin and api-origin' >&2
  usage >&2
  exit 2
fi
[ "${#positionals[@]}" -ge 1 ] && web_origin=${positionals[0]}
[ "${#positionals[@]}" -ge 2 ] && api_origin=${positionals[1]}

cd "$(dirname "$0")/.."

current_root=$(git rev-parse --show-toplevel)
current_sha=$(git rev-parse HEAD)
current_branch=$(git rev-parse --abbrev-ref HEAD)
dirty='clean'
[ -n "$(git status --porcelain)" ] && dirty='dirty'

# ---- web: where does the dev server load modules from? ---------------------
# Vite embeds the absolute filesystem path of out-of-root imports in every
# served module, as /@fs/<path> URLs and bare /<path> strings. The longest
# common path of those is the checkout the server was started in, which is
# where Vite reads files from.
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
web_note=''
web_marker='not checked'
web_marker_note=''
if [ "$expected_marker_given" = 'yes' ]; then
  web_marker='no'
  web_marker_note='expected marker not found in served module; stale/cached web modules are the likely cause'
  if [ -n "$web_body" ] && grep -Fq -- "$expected_marker" <<<"$web_body"; then
    web_marker='yes'
    web_marker_note=''
  fi
fi

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

# ---- api: probe and report --------------------------------------------------
api_reachable='no'
api_note=''
api_sha=''
api_root=''
api_root_matches='not determinable'
if api_body=$(curl -fsS -m 5 "$api_origin/api/health" 2>/dev/null); then
  api_reachable='yes'
  if printf '%s\n' "$api_body" | grep -q '"service"[[:space:]]*:[[:space:]]*"obiter-api"'; then
    api_sha_pattern='"commitSha"[[:space:]]*:[[:space:]]*"([^\"]+)"'
    api_root_pattern='"checkoutRoot"[[:space:]]*:[[:space:]]*"([^\"]+)"'
    if [[ $api_body =~ $api_sha_pattern ]]; then
      api_sha=${BASH_REMATCH[1]}
    fi
    if [[ $api_body =~ $api_root_pattern ]]; then
      api_root=${BASH_REMATCH[1]}
    fi

    if [ -n "$api_sha" ] && [ -n "$api_root" ]; then
      api_root_matches='yes'
      [ "$api_root" = "$current_root" ] || api_root_matches='no'
      api_note='reachable, development provenance exposed by /api/health'
    else
      api_note='reachable, but development provenance fields are absent (production or old server); API provenance not determinable'
    fi
  else
    api_note="reachable, but response does not look like this stack's /api/health"
  fi
else
  api_note="unreachable at $api_origin/api/health — is the API running?"
fi

# ---- report -----------------------------------------------------------------
web_path_pass='FAIL'
[ "$web_matches" = 'yes' ] && web_path_pass='PASS'
web_pass='FAIL'
if [ "$web_matches" = 'yes' ] && { [ "$web_marker" = 'yes' ] || [ "$web_marker" = 'not checked' ]; }; then
  web_pass='PASS'
fi

echo '== provenance check ============================='
echo "run from checkout : $current_root"
echo "checkout HEAD     : $current_sha ($current_branch, $dirty)"
echo "  NOTE            : path match proves this checkout, not that a long-running"
echo "                  : server reloaded its latest commit — restart the dev"
echo "                  : server after checkout/pull/commit changes."
echo

echo "web  $web_origin"
if [ -n "$web_module" ]; then
  echo "  module probed   : $web_module"
fi
if [ -n "$web_root" ]; then
  echo "  served from     : $web_root"
fi
echo "  matches checkout : $web_matches  [$web_path_pass]"
if [ "$expected_marker_given" = 'yes' ]; then
  marker_pass='FAIL'
  [ "$web_marker" = 'yes' ] && marker_pass='PASS'
  echo "  expected marker  : checked  [$marker_pass]"
else
  echo '  revision freshness: NOT CHECKED (no expected-marker given)'
fi
if [ -n "$web_marker_note" ]; then
  echo "  marker note      : $web_marker_note"
fi
if [ -n "$web_note" ]; then
  echo "  note            : $web_note"
fi

echo
echo "api  $api_origin"
echo "  reachable       : $api_reachable"
if [ -n "$api_sha" ]; then
  echo "  commit sha      : $api_sha"
fi
if [ -n "$api_root" ]; then
  echo "  checkout root   : $api_root"
  echo "  root matches    : $api_root_matches"
fi
echo "  provenance      : $api_note"
echo
echo 'PR evidence block (paste into the PR body) ======'
echo "checkout HEAD: $current_sha ($dirty)"
if [ -n "$web_root" ]; then
  echo "served: $web_root"
fi
if [ "$expected_marker_given" = 'yes' ]; then
  echo "revision freshness: $web_marker"
else
  echo 'revision freshness: NOT CHECKED (no expected-marker given)'
fi
if [ -n "$api_sha" ] && [ -n "$api_root" ]; then
  echo "api checkout HEAD: $api_sha"
  echo "api served: $api_root"
else
  echo "api provenance: not determinable ($api_note)"
fi
echo "[screenshot]  (web provenance: $web_pass)"
echo '=================================================='

[ "$web_pass" = 'PASS' ] && [ "$api_root_matches" != 'no' ]
