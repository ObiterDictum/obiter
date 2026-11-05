# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.19.0
ARG BUN_VERSION=1.4.2

FROM node:${NODE_VERSION}-slim AS build
COPY --from=oven/bun:1.4.2-slim /usr/local/bin/bun /usr/local/bin/bun
ENV CI=1
ARG OBITER_BUILD_COMMIT=""
ARG OBITER_BUILD_DIRTY=""

WORKDIR /repo

COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json

RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @obiter/web

COPY apps/web ./apps/web

RUN OBITER_BUILD_COMMIT="$OBITER_BUILD_COMMIT" OBITER_BUILD_DIRTY="$OBITER_BUILD_DIRTY" \
    bun --bun run --filter @obiter/web build

FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json /repo/bun.lock /repo/tsconfig.base.json ./
COPY --from=build /repo/packages ./packages

EXPOSE 3000

CMD ["bun", "apps/web/serve.mjs"]
