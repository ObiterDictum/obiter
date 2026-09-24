# syntax=docker/dockerfile:1.7
#
# Production image for @obiter/web (TanStack Start SSR).
#
# BUILD INVOCATION — build from the REPO ROOT with the context set to it, and
# pass the build provenance so the emitted marker names the artifact:
#
#     docker build -f apps/web/Dockerfile -t obiter-web \
#       --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" \
#       --build-arg OBITER_BUILD_DIRTY="$(test -n "$(git status --porcelain)" && echo 1 || echo 0)" \
#       .
#
# The context must be the repo root because the COPY paths span the monorepo
# workspace (packages/*, the root lockfile, etc.). In Dokploy: set "Build
# Context" to the repository root and "Dockerfile path" to apps/web/Dockerfile,
# and set the two build args above (Dokploy must supply the commit, since .git
# is excluded from the build context). Omitting the args is not fatal: the
# marker records null and the measurement harness refuses the image.
#
# Docker consults ONLY the .dockerignore at the build-context root, so all
# exclusions (including the .env* secret exclusions) live in the REPO-ROOT
# /.dockerignore — not next to this Dockerfile. See apps/web/.dockerignore for
# why a nested file would be misleading.
#
# Follows docs/specs/deployment.md: the repo pins Bun via .bun-version and the
# install and build run on Bun. The build stage still starts FROM node because
# third-party packages carry Node lifecycle scripts (esbuild's `node
# install.js` postinstall); the pinned Bun binary is copied in beside it.
# No secrets are baked into the image — all runtime config comes from the
# environment (OBITER_WEB_ORIGIN, BETTER_AUTH_URL). The web app calls the API
# with relative URLs over same-domain Dokploy/Traefik routing, so it does not
# need the API origin at build time either.
#
# This Dockerfile builds the web app and the workspace packages it depends on.
# It does NOT build services/api (owned by the Redact track) or run migrations.
#
# Build-verified: this stage and the bun runtime stage below are built and
# curl-smoked in the Bun migration evidence run (see the PR); serve.mjs also
# runs under bun in scripts/serve.test.mjs.

ARG NODE_VERSION=24.19.0
ARG BUN_VERSION=1.4.2

# --- Build stage -------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
# Bun drives the install and the build; node hosts third-party lifecycle
# scripts such as esbuild's postinstall. The oven/bun image ships /usr/local/bin/bun
# as a regular file, so a plain COPY lands a runnable binary here.
COPY --from=oven/bun:${BUN_VERSION}-slim /usr/local/bin/bun /usr/local/bin/bun
ENV CI=1
# Build provenance for the emitted artifact. .git is excluded from the build
# context, so the commit cannot be read here; the CI workflow passes it as
# --build-arg. A missing arg leaves the marker's fields null (the measurement
# harness then refuses the artifact); a malformed one fails the build in
# build-provenance.mjs rather than writing an unmatchable marker.
ARG OBITER_BUILD_COMMIT=""
ARG OBITER_BUILD_DIRTY=""

WORKDIR /repo

# Copy the workspace manifests first for a dependency-cache layer.
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json

RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @obiter/web

# Copy the web app source (workspace package sources were already copied for the
# install resolution; bring in the app sources needed to build).
COPY apps/web ./apps/web

# The same Bun-runtime build command CI runs: vite bundles, then
# build-provenance.mjs writes dist/.obiter-build.json naming this commit.
RUN OBITER_BUILD_COMMIT="$OBITER_BUILD_COMMIT" OBITER_BUILD_DIRTY="$OBITER_BUILD_DIRTY" \
    bun --bun run --filter @obiter/web build

# --- Runtime stage -----------------------------------------------------------
# Bun runs the SSR host: apps/web/serve.mjs is dependency-light first-party
# code (node:http/node:stream/node:zlib APIs, all implemented by bun) and
# scripts/serve.test.mjs covers it under bun.
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
# Same-domain routing: the web origin is the site origin; the API is reachable
# at /api via the reverse proxy. No API host is configured here.
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Bring the built web app + the workspace runtime deps it imports. bun.lock
# doubles as the workspace-root marker packages/config/src/local-env.mjs walks
# up to, exactly as the pre-migration workspace marker did.
COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json /repo/bun.lock /repo/tsconfig.base.json ./
COPY --from=build /repo/packages ./packages

EXPOSE 3000

# Dependency-free SSR host (apps/web/serve.mjs) over the built dist/. It serves
# dist/client static assets and forwards everything else to the SSR handler.
CMD ["bun", "apps/web/serve.mjs"]
