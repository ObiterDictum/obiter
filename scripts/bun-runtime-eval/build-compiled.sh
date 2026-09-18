#!/usr/bin/env bash
# Ahead-of-time TypeScript transform for the runtime comparison.
#
# The repository's workspace packages export TypeScript source
# (`"exports": "./src/index.ts"`) and its relative imports are extensionless,
# which Node's ESM resolver cannot load without a loader such as tsx. So the
# compiled rows are produced by one esbuild pass that:
#
#   * bundles this repository's own source (workspace packages are aliased to
#     their src entry points, because `--packages=external` would otherwise
#     leave them as bare specifiers resolving to .ts at runtime);
#   * leaves every node_modules dependency external and untouched, so the
#     dependency graph, resolution and versions are identical to the tsx path;
#   * emits into services/api/dist (Node) and services/api/dist-bun (Bun),
#     both at the same directory depth as src, because
#     `services/api/src/migrate.ts` resolves `packages/database/migrations`
#     through `import.meta.url` and three parent segments.
#
# The two bundles differ only in the adapter entry point, so a compiled Node
# run and a compiled Bun run execute byte-identical first-party JavaScript.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
esbuild="$(ls -d "$root"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1)"
[ -n "$esbuild" ] && [ -x "$esbuild" ] || { echo "esbuild not found under $root" >&2; exit 1; }

aliases=()
for package in config contracts legal-schema legal-source-provider ooxml \
  rampart-inference redaction-policy search-client verification-core; do
  aliases+=("--alias:@obiter/${package}=${root}/packages/${package}/src/index.ts")
done
# @obiter/config also exports plain .mjs subpaths; alias them so a prefix match
# cannot send `@obiter/config/local-env` to index.ts.
aliases+=("--alias:@obiter/config/env-keys=${root}/packages/config/src/env-keys.mjs")
aliases+=("--alias:@obiter/config/local-env=${root}/packages/config/src/local-env.mjs")

common=(--bundle --platform=node --format=esm --target=node22 --packages=external
  --log-level=warning --sourcemap=external "${aliases[@]}")

cd "$root/services/api"
"$esbuild" "${common[@]}" --outfile=dist/server.js src/server.ts
"$esbuild" "${common[@]}" --outfile=dist-bun/server-bun.js src/server-bun.ts

# A bundle emitted into a package directory resolves its bare imports from that
# directory's node_modules. pnpm links a package's direct dependencies there
# only, and these three are reached through workspace packages, so they are not
# linked in services/api/node_modules. Link them explicitly so the compiled row
# uses the same versions as the tsx row rather than failing to resolve.
# The real package lives in the pnpm store; find it by its store directory name
# rather than guessing, so the compiled row links the same version pnpm resolved.
link_package() {
  local name="$1" glob="$2" store
  store="$(ls -d "$root"/node_modules/.pnpm/${glob}/node_modules/${name} 2>/dev/null | head -1)"
  [ -n "$store" ] || { echo "could not resolve ${name} in the pnpm store" >&2; exit 1; }
  local target="$root/services/api/node_modules/${name}"
  [ -e "$target" ] || { mkdir -p "$(dirname "$target")"; ln -s "$store" "$target"; echo "linked ${name}"; }
}
link_package meilisearch 'meilisearch@*'
link_package fast-xml-parser 'fast-xml-parser@*'
link_package '@huggingface/transformers' '@huggingface+transformers@*'

echo "built:"
ls -la dist/server.js dist-bun/server-bun.js
