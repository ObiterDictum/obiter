#!/usr/bin/env bash
# Re-runs the whole runtime evaluation on a task-owned scratch checkout.
#
# Everything below writes only inside $BUN_EVAL_ROOT (default
# /tmp/obiter-bun-eval: the scratch worktree, the pinned Bun binary and the
# raw JSON) and only into the `obiter_bun_eval` database. It never touches
# the shared stack on 3000/8787, another lane's worktree, or the
# `obiter_lane_*` databases.
#
#   scripts/bun-runtime-eval/reproduce.sh
set -euo pipefail

# The checkout this script sits in supplies .env, .npmrc and the harness.
lane="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval_root="${BUN_EVAL_ROOT:-/tmp/obiter-bun-eval}"
checkout="$eval_root/checkout"
bun="$eval_root/tools/bun-linux-x64/bun"
harness="$lane/scripts/bun-runtime-eval"
out="$eval_root/raw"
eval_commit="${BUN_EVAL_COMMIT:-67afb9fa8cdfc0f28729d218cdbb76fc9738329a}"
heavy="${OBITER_HEAVY:-/home/karl/bin/obiter-heavy}"
mkdir -p "$out"

run_serialised() {
  if [ -x "$heavy" ]; then "$heavy" "$@"; else "$@"; fi
}

# ---- 1. scratch checkout, pinned to the commit under evaluation -------------
if [ ! -d "$checkout/.git" ]; then
  git -C "$lane" worktree add --detach "$checkout" "$eval_commit"
fi
git -C "$checkout" rev-parse HEAD

# The scratch checkout owns a database named after this experiment, not a lane.
psql "postgresql://obiter:obiter@localhost:5432/postgres" -tAc \
  "select 1 from pg_database where datname='obiter_bun_eval'" | grep -q 1 ||
  psql "postgresql://obiter:obiter@localhost:5432/postgres" -c "create database obiter_bun_eval"

# `.env` is derived from this checkout's file with the database and ports
# replaced. The Resend key is dropped so no email path can send anything.
lane_db="$(sed -n 's#^DATABASE_URL=.*localhost:5432/\([^[:space:]]*\).*#\1#p' "$lane/.env" | head -1)"
lane_api_port="$(sed -n 's#^PORT=\([0-9]*\).*#\1#p' "$lane/.env" | head -1)"
[ -n "$lane_db" ] && [ -n "$lane_api_port" ] || {
  echo "could not derive DATABASE_URL/PORT from $lane/.env" >&2; exit 1; }
sed -e "s#${lane_db}#obiter_bun_eval#g" \
    -e 's#^PORT=.*#PORT=8811#' \
    -e 's#^OBITER_WEB_PORT=.*#OBITER_WEB_PORT=3111#' \
    -e "s#localhost:${lane_api_port}#localhost:8811#g" \
    -e 's#^OBITER_API_ORIGIN=.*#OBITER_API_ORIGIN=http://127.0.0.1:8811#' \
    -e '/^OBITER_RESEND_API_KEY=/d' \
    "$lane/.env" > "$checkout/.env"

# ---- 2. install the same dependencies, CPU-only ONNX ------------------------
cp "$lane/.npmrc" "$checkout/.npmrc"
[ -d "$checkout/node_modules" ] ||
  (cd "$checkout" && ONNXRUNTIME_NODE_INSTALL_CUDA=skip ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
     run_serialised pnpm install --frozen-lockfile)

# ---- 3. the experiment's own source overlay --------------------------------
# The harness lives in this repository under scripts/bun-runtime-eval; the
# three services/api/src overlay files live under overlay/. Both are copied
# into the scratch checkout so the pinned commit under test keeps its own
# canonical sources untouched.
mkdir -p "$checkout/scripts/bun-runtime-eval"
cp "$harness"/compare.mjs "$harness"/gates.mjs "$harness"/timeouts.mjs \
   "$harness"/decompose.mjs "$checkout/scripts/bun-runtime-eval/"
cp "$harness"/build-compiled.sh "$checkout/scripts/bun-runtime-eval/"
cp "$harness"/overlay/runtime.ts "$harness"/overlay/server.ts \
   "$harness"/overlay/server-bun.ts "$checkout/services/api/src/"

# ---- 4. pinned Bun ----------------------------------------------------------
if [ ! -x "$bun" ]; then
  mkdir -p "$eval_root/tools" && cd "$eval_root/tools"
  curl -fsSL -o bun-linux-x64.zip \
    https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip
  echo '36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  bun-linux-x64.zip' | sha256sum -c -
  busybox unzip -o -q bun-linux-x64.zip
fi
"$bun" --version
# The harness spawns the Bun row through this path.
export BUN_EVAL_BUN="$bun"

# ---- 5. ahead-of-time build for the compiled rows ---------------------------
bash "$checkout/scripts/bun-runtime-eval/build-compiled.sh"

# ---- 6. measurements (serialised through the heavy lock) -------------------
cd "$checkout"
run_serialised bash -c '
  set -e
  node scripts/bun-runtime-eval/compare.mjs --paired --rounds 3 --settle-ms 4000 --out '"$out"'/paired-3rounds.json
  node scripts/bun-runtime-eval/compare.mjs --runtime node-compiled --settle-ms 4000 --out '"$out"'/compiled-node.json
  node scripts/bun-runtime-eval/compare.mjs --runtime bun-compiled  --settle-ms 4000 --out '"$out"'/compiled-bun.json
'

# ---- 7. correctness gates and transport timeouts ---------------------------
run_serialised bash -c '
  set -e
  node scripts/bun-runtime-eval/gates.mjs --runtime node --out '"$out"'/gates-node.json || true
  node scripts/bun-runtime-eval/gates.mjs --runtime bun  --out '"$out"'/gates-bun.json  || true
  node scripts/bun-runtime-eval/timeouts.mjs --runtime node --out '"$out"'/timeouts-node.json
  node scripts/bun-runtime-eval/timeouts.mjs --runtime bun  --out '"$out"'/timeouts-bun.json
  node node_modules/tsx/dist/cli.mjs scripts/bun-runtime-eval/decompose.mjs --out '"$out"'/decompose-node.json
  '"$bun"' run scripts/bun-runtime-eval/decompose.mjs --out '"$out"'/decompose-bun.json
'

echo "raw results in $out"
