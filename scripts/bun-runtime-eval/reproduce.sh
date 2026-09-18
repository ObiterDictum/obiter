#!/usr/bin/env bash
# Re-runs the repaired runtime evaluation on a task-owned scratch checkout.
#
# Pipeline (revision 2):
#   1. a paired, alternating compiled-Node vs compiled-Bun campaign, 3 rounds,
#      with ONNX inference and verification raised to 120 observations per
#      runtime per round so their p95 is not the sample maximum;
#   2. a paired decomposition probe (no HTTP server in the path) under plain
#      Node and plain Bun, alternating, 3 rounds;
#   3. the correctness gates and transport-timeout probes on both runtimes;
#   4. derived tables and an artifact-to-table mapping from the raw JSON.
#
# Node+tsx is deliberately not re-measured: the retained revision-1 evidence
# for it is still valid and is labelled separately. Only the compiled rows,
# which revision 1 measured once and outside the paired design, are re-run.
#
# Everything below writes only inside $BUN_EVAL_ROOT (default
# /tmp/obiter-bun-eval: the scratch worktree, the pinned Bun binary and the
# raw JSON) and only into the `obiter_bun_eval` database. It never touches the
# shared stack on 3000/8787, another lane's worktree, or the `obiter_lane_*`
# databases.
#
#   scripts/bun-runtime-eval/reproduce.sh
set -euo pipefail

lane="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval_root="${BUN_EVAL_ROOT:-/tmp/obiter-bun-eval}"
checkout="$eval_root/checkout"
bun="$eval_root/tools/bun-linux-x64/bun"
harness="$lane/scripts/bun-runtime-eval"
out="${BUN_EVAL_OUT:-$eval_root/r2}"
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
   "$harness"/decompose.mjs "$harness"/analyze.mjs "$checkout/scripts/bun-runtime-eval/"
rm -rf "$checkout/scripts/bun-runtime-eval/lib"
cp -r "$harness"/lib "$checkout/scripts/bun-runtime-eval/lib"
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
export BUN_EVAL_BUN="$bun"

# ---- 5. ahead-of-time build for the compiled rows ---------------------------
bash "$checkout/scripts/bun-runtime-eval/build-compiled.sh"

# ---- 6. primary paired compiled campaign, tails at n=120 --------------------
cd "$checkout"
run_serialised node scripts/bun-runtime-eval/compare.mjs \
  --pair node-compiled,bun-compiled --rounds 3 \
  --journey-requests verification_run=120,redaction_run_inference=120 \
  --rss-interval-ms 250 --quiet-probe-ms 5000 --settle-ms 4000 \
  --out "$out"/paired-compiled-rounds3-n120.json

# ---- 7. paired decomposition probes, alternating Node and Bun ---------------
for round in 1 2 3; do
  if [ $((round % 2)) -eq 1 ]; then order="node bun"; else order="bun node"; fi
  for runtime in $order; do
    node_out="$out/decompose-$runtime-r$round.json"
    if [ "$runtime" = bun ]; then
      run_serialised "$bun" run scripts/bun-runtime-eval/decompose.mjs --runtime bun --out "$node_out"
    else
      run_serialised node node_modules/tsx/dist/cli.mjs scripts/bun-runtime-eval/decompose.mjs --runtime node --out "$node_out"
    fi
  done
done

# ---- 8. correctness gates and transport timeouts ---------------------------
run_serialised node scripts/bun-runtime-eval/gates.mjs --runtime node --out "$out"/gates-node.json || true
run_serialised node scripts/bun-runtime-eval/gates.mjs --runtime bun  --out "$out"/gates-bun.json  || true
run_serialised node scripts/bun-runtime-eval/timeouts.mjs --runtime node --out "$out"/timeouts-node.json
run_serialised node scripts/bun-runtime-eval/timeouts.mjs --runtime bun  --out "$out"/timeouts-bun.json

# ---- 9. derived tables and the artifact-to-table mapping --------------------
node "$harness"/analyze.mjs \
  --campaign "$out"/paired-compiled-rounds3-n120.json \
  --out "$out"/derived-tables
node "$harness"/analyze.mjs \
  --campaign "$out"/paired-compiled-rounds3-n120.json \
  --historical-node "${BUN_EVAL_HIST_NODE:-/tmp/obiter-bun-eval/raw/compiled-node.json}" \
  --historical-bun "${BUN_EVAL_HIST_BUN:-/tmp/obiter-bun-eval/raw/compiled-bun.json}" \
  --out "$out"/derived-tables-with-history

echo "raw results in $out"
