# syntax=docker/dockerfile:1.7
#
# Production image for @obiter/web (TanStack Start SSR).
#
# BUILD INVOCATION — build from the REPO ROOT with the context set to it:
#
#     docker build -f apps/web/Dockerfile -t obiter-web .
#
# The context must be the repo root because the COPY paths span the monorepo
# workspace (packages/*, the root lockfile, etc.). In Dokploy: set "Build
# Context" to the repository root and "Dockerfile path" to apps/web/Dockerfile.
#
# Docker consults ONLY the .dockerignore at the build-context root, so all
# exclusions (including the .env* secret exclusions) live in the REPO-ROOT
# /.dockerignore — not next to this Dockerfile. See apps/web/.dockerignore for
# why a nested file would be misleading.
#
# Follows docs/specs/deployment.md: Node 22, pnpm via corepack, monorepo build.
# No secrets are baked into the image — all runtime config comes from the
# environment (OBITER_WEB_ORIGIN, BETTER_AUTH_URL). The web app calls the API
# with relative URLs over same-domain Dokploy/Traefik routing, so it does not
# need the API origin at build time either.
#
# This Dockerfile builds the web app and the workspace packages it depends on.
# It does NOT build services/api (owned by the Redact track) or run migrations.
#
# NOTE: not yet `docker build`-verified in the development environment (no
# Docker available there). The flow is standard Node 22 + corepack pnpm; the
# apps/web/serve.mjs host it starts has been exercised against a local
# `vite build` output and serves SSR routes and static assets correctly.

ARG NODE_VERSION=24.19.0

# --- Build stage -------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
ENV CI=1
# corepack pnpm — the repo pins pnpm@10.14.0 via packageManager.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /repo

# Copy the workspace manifests first for a dependency-cache layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @obiter/web... --filter @obiter/web

# Copy the web app source (workspace package sources were already copied for the
# install resolution; bring in the app sources needed to build).
COPY apps/web ./apps/web

RUN pnpm --filter @obiter/web build

# --- Runtime stage -----------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
# Same-domain routing: the web origin is the site origin; the API is reachable
# at /api via the reverse proxy. No API host is configured here.
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Bring the built web app + the workspace runtime deps it imports.
COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/tsconfig.base.json ./
COPY --from=build /repo/packages ./packages

EXPOSE 3000

# Dependency-free SSR host (apps/web/serve.mjs) over the built dist/. It serves
# dist/client static assets and forwards everything else to the SSR handler.
CMD ["node", "apps/web/serve.mjs"]
