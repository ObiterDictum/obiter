# syntax=docker/dockerfile:1.7
#
# Production image for @obiter/api, with both runtime adapters.
#
# BUILD INVOCATION — build from the REPO ROOT with the context set to it:
#
#     # Bun runtime (the new default; this is the last stage, so it is default)
#     docker build -f services/api/Dockerfile -t obiter-api-bun .
#
#     # Node runtime (the rollback path; same application code)
#     docker build -f services/api/Dockerfile --target runtime-node -t obiter-api-node .
#
# The context must be the repo root because the COPY paths span the monorepo
# workspace, and the repo-root .dockerignore (with its .env* exclusions) only
# applies at the context root. In Dokploy: Build Context = repository root,
# Dockerfile path = services/api/Dockerfile, and set the target to select the
# adapter.
#
# The two stages run the same application: `createApiRuntime()` in
# `services/api/src/runtime.ts` builds it once, and the entry point only picks
# the socket layer. Rolling back is redeploying the Node target — no schema or
# data migration is involved, though the API applies pending migrations at
# startup from either runtime.
#
# The Rampart detection model is prefetched into the image at
# /opt/obiter/rampart-models and OBITER_RAMPART_CACHE_DIR points there, so the
# image can run CPU inference with no first-request download. Mounting a volume
# over that path shadows the baked weights: if you do, warm it with
# `bun run prefetch:rampart` first, or the image starts heuristics-only.
#
# No secrets are baked into the image — all runtime configuration comes from the
# environment, and NODE_ENV=production is required by env.ts (an unset NODE_ENV
# is a boot failure, not a silent development mode).
#
# CPU-only ONNX Runtime: onnxruntime-node's postinstall is what fetches the
# optional CUDA/TensorRT providers (~343 MB) nothing here uses. Bun runs
# lifecycle scripts only for trusted dependencies, and onnxruntime-node is not
# in bun's default-trusted set, so the postinstall never runs and no provider
# payload is fetched — there is no .npmrc setting to carry into the image.
# services/api/src/rampart-install-config.test.ts pins that policy and fails a
# Dockerfile that opts the package in (`bun pm trust onnxruntime-node` or
# ONNXRUNTIME_NODE_INSTALL_CUDA) or installs without the bun.lock beside it.
# A GPU builder opts in explicitly on its own machine; images stay CPU.
#
# Follows docs/specs/deployment.md; the deployment notes there cover the proxy
# limits Bun does not expose.

ARG NODE_VERSION=24.19.0
ARG BUN_VERSION=1.4.2
ARG RAMPART_CACHE_DIR=/opt/obiter/rampart-models

# --- Build stage -------------------------------------------------------------
# FROM node, not oven/bun: the dependency graph carries Node lifecycle scripts
# (esbuild's `node install.js` postinstall, which bun runs because esbuild is
# in its default-trusted set). The pinned Bun binary is copied in beside it and
# drives the install, the model prefetch and everything else first-party.
FROM node:${NODE_VERSION}-slim AS build
COPY --from=oven/bun:${BUN_VERSION}-slim /usr/local/bin/bun /usr/local/bin/bun
ENV CI=1
# A global ARG is not visible inside a stage; redeclare it or the prefetch
# silently falls back to ~/.cache and the runtime COPY finds nothing.
ARG RAMPART_CACHE_DIR

WORKDIR /repo

# Manifests first for a dependency-cache layer. Only @obiter/api's production
# dependency graph is installed: no root devDependencies (eslint, playwright)
# and no workspace devDependencies (typescript) reach a runtime path here, and
# tsx — the Node adapter's loader — is a production dependency of @obiter/api.
# The CPU-only ONNX policy needs no file copied here: bun blocks
# onnxruntime-node's postinstall by default (untrusted), and
# services/api/src/rampart-install-config.test.ts is what keeps that true.
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/api/package.json ./services/api/package.json

RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter @obiter/api

# The application source and the migration SQL the API applies at startup.
COPY services/api ./services/api
COPY scripts/prefetch-rampart-model.ts ./scripts/prefetch-rampart-model.ts

# Bake the detection model so the image does not depend on Hugging Face at run
# time. The prefetch runs on Bun and resolves its bare imports (onnxruntime-node,
# @obiter/rampart-inference) from the hoisted production install at /repo.
# Deliberately not best-effort: a build that silently produced a heuristics-only
# image would fail later, on a user's redaction run, where nobody is looking.
WORKDIR /repo/services/api
RUN OBITER_RAMPART_CACHE_DIR=${RAMPART_CACHE_DIR} \
    bun /repo/scripts/prefetch-rampart-model.ts

# --- Node runtime (rollback) -------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime-node
ENV NODE_ENV=production
ENV PORT=8787
ARG RAMPART_CACHE_DIR
ENV OBITER_RAMPART_CACHE_DIR=${RAMPART_CACHE_DIR}

WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build ${RAMPART_CACHE_DIR} ${RAMPART_CACHE_DIR}

WORKDIR /repo/services/api
EXPOSE 8787
# tsx runs the TypeScript entry directly; it resolves from the hoisted
# production node_modules the filtered install populated.
CMD ["node", "--import", "tsx", "src/server.ts"]

# --- Bun runtime (default) ---------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime-bun
ENV NODE_ENV=production
ENV PORT=8787
ARG RAMPART_CACHE_DIR
ENV OBITER_RAMPART_CACHE_DIR=${RAMPART_CACHE_DIR}

WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build ${RAMPART_CACHE_DIR} ${RAMPART_CACHE_DIR}

WORKDIR /repo/services/api
EXPOSE 8787
CMD ["bun", "src/server-bun.ts"]
