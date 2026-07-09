# Obiter API

Phase 0.2 uses Hono for the API service and `better-auth` for identity.

## Current Scope

- mounts `better-auth` at `/api/auth/*`
- enables email/password sign-in for provisioned users
- enables magic-link sign-in with hashed verification tokens
- exposes `GET /api/me` as the organisation-aware current-user contract
- records sign-out audit entries through the server-side `/api/auth/sign-out` flow
- exposes public legal search endpoints at `/api/search/*` for the product and marketing clients

## Environment

Production must provide:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `OBITER_WEB_ORIGIN`
- `OBITER_MAGIC_LINK_WEBHOOK_URL`
- `OBITER_MAGIC_LINK_WEBHOOK_SECRET`
- `MEILISEARCH_HOST`
- `MEILISEARCH_SEARCH_API_KEY`
- `MEILISEARCH_ADMIN_API_KEY`
- `LEGAL_AUTHORITIES_INDEX`

Production may also provide:

- `OBITER_MARKETING_ORIGIN` when the marketing site calls this API from a separate origin such as `https://obiter.tech`
- `OBITER_DESKTOP_ORIGIN` when the desktop app uses a non-default auth callback origin
- `MOJ_FIND_CASE_LAW_BASE_URL` to override the public Find Case Law upstream
- `MOJ_FIND_CASE_LAW_RATE_LIMIT` to tune the public upstream fetch limiter

Development falls back to local defaults so the service can typecheck and boot before hosted infrastructure is provisioned.

## Deploying Only This API

Deploy `@obiter/api` as its own service. Do not use the root `pnpm build` or a product web start command for the API service, because those target the whole monorepo.

Recommended Dokploy service settings:

```bash
pnpm install --frozen-lockfile
pnpm --filter @obiter/api build
pnpm --filter @obiter/api start
```

Set `NODE_ENV=production` and `PORT` to the port Dokploy exposes to the container. Point the service domain at a backend hostname such as `https://api.obiter.tech` or `https://search-api.obiter.tech`.

For the marketing site, set `VITE_API_ORIGIN` to the API hostname at build time. If the marketing frontend calls the API directly across origins, set `OBITER_MARKETING_ORIGIN` on the API service to the marketing site origin.
