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
# `pnpm prefetch:rampart` first, or the image starts heuristics-only.
#
# No secrets are baked into the image — all runtime configuration comes from the
# environment, and NODE_ENV=production is required by env.ts (an unset NODE_ENV
# is a boot failure, not a silent development mode).
#
# Follows docs/specs/deployment.md; the deployment notes there cover the proxy
# limits Bun does not expose.

ARG NODE_VERSION=24.19.0
ARG BUN_VERSION=1.4.2
ARG RAMPART_CACHE_DIR=/opt/obiter/rampart-models

# --- Build stage -------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
ENV CI=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# A global ARG is not visible inside a stage; redeclare it or the prefetch
# silently falls back to ~/.cache and the runtime COPY finds nothing.
ARG RAMPART_CACHE_DIR

WORKDIR /repo

# Manifests first for a dependency-cache layer. Only @obiter/api's production
# dependency graph is installed: no root devDependencies (eslint, playwright,
# vitest) and no workspace devDependencies (typescript, vitest) reach a runtime
# path here, and tsx — the Node adapter's loader — is a production dependency of
# @obiter/api. ONNXRUNTIME_NODE_INSTALL_CUDA=skip avoids the optional
# CUDA/TensorRT provider download (~343 MB) nothing in Obiter uses.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/api/package.json ./services/api/package.json

RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    pnpm install --frozen-lockfile --prod --filter @obiter/api...

# The application source and the migration SQL the API applies at startup.
COPY services/api ./services/api
COPY scripts/prefetch-rampart-model.ts ./scripts/prefetch-rampart-model.ts

# Bake the detection model so the image does not depend on Hugging Face at run
# time. The symlink lets the prefetch script's bare imports resolve against the
# API package's dependency tree (the root one is deliberately not installed).
# Deliberately not best-effort: a build that silently produced a heuristics-only
# image would fail later, on a user's redaction run, where nobody is looking.
WORKDIR /repo/services/api
RUN ln -s /repo/services/api/node_modules /repo/scripts/node_modules \
 && OBITER_RAMPART_CACHE_DIR=${RAMPART_CACHE_DIR} \
    node --import tsx /repo/scripts/prefetch-rampart-model.ts

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
# tsx runs the TypeScript entry directly; it resolves from this package's own
# node_modules, which the filtered install populated.
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
