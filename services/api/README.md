# Obiter API

Phase 0.2 uses Hono for the API service and `better-auth` for identity.

## Current Scope

- mounts `better-auth` at `/api/auth/*`
- enables self-serve email/password sign-up and sign-in
- enables magic-link sign-in with hashed verification tokens (existing users only)
- supports org-less users after registration; organisations are created explicitly via `POST /api/organisations`
- exposes `GET /api/me` as the organisation-aware current-user contract
- records sign-in/sign-up/sign-out audit entries through the `/api/auth/*` flow
- exposes public legal search endpoints at `/api/search/*` for the product and marketing clients

## Environment

Production must provide:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `OBITER_WEB_ORIGIN`
- `OBITER_RESEND_API_KEY`
- `MEILISEARCH_HOST`
- `MEILISEARCH_SEARCH_API_KEY`
- `MEILISEARCH_ADMIN_API_KEY`
- `LEGAL_AUTHORITIES_INDEX`

Production may also provide:

- `OBITER_EMAIL_FROM` to override the Resend sender address (defaults to `onboarding@resend.dev`)
- `OBITER_MARKETING_ORIGIN` when the marketing site calls this API from a separate origin such as `https://obiter.tech`
- `OBITER_DESKTOP_ORIGIN` when the desktop app uses a non-default auth callback origin
- `MOJ_FIND_CASE_LAW_BASE_URL` to override the public Find Case Law upstream
- `MOJ_FIND_CASE_LAW_RATE_LIMIT` to tune the public upstream fetch limiter

Development requires `BETTER_AUTH_SECRET` in the environment (for example via a local `.env` file). There is no shipped fallback secret. Set `NODE_ENV=development`, or set `OBITER_LOCAL_DEVELOPMENT=1` when `NODE_ENV` is unset. Other local defaults remain so the service can boot before hosted infrastructure is provisioned. With the web Vite proxy, the development default for `BETTER_AUTH_URL` is `http://localhost:3000`, matching `OBITER_WEB_ORIGIN`; override both deliberately when using another local origin. In development the API also trusts electron-vite renderer Origins on loopback http only (`http://localhost` and `http://127.0.0.1`, ports `5173`–`5199`) for both CORS and better-auth — the same `isDevDesktopRendererOrigin` gate, no port wildcards — so `pnpm dev:desktop` can sign in through the renderer `/api` proxy. Production still only trusts configured web/desktop/marketing origins. If `OBITER_RESEND_API_KEY` is not configured in development, the API logs the complete magic-link URL with a `[dev-only]` marker instead of sending an email. Never rely on that fallback in production.

## Accounts

Sign-up is public and self-serve (via `/sign-up/email` and the app's "Create account" mode). There are no seed scripts and no seeded accounts — every account, including the first one in a fresh environment, is created by registering through the app. Registration creates an org-less user; the user then explicitly creates an organisation via `POST /api/organisations` and becomes its `owner` at that point.

## Deploying Only This API

Deploy `@obiter/api` as its own service. Do not use the root `pnpm build` or a product web start command for the API service, because those target the whole monorepo.

Recommended Dokploy service settings:

```bash
pnpm install --frozen-lockfile
pnpm --filter @obiter/api build
pnpm --filter @obiter/api start
```

Production deploys **must** set `NODE_ENV=production` (and `PORT` to the port Dokploy exposes to the container). Unknown or unset `NODE_ENV` without `OBITER_LOCAL_DEVELOPMENT=1` refuses startup instead of falling through to the development path, which would enable the loopback electron-vite Origin trust above. Point the service domain at a backend hostname such as `https://api.obiter.tech` or `https://search-api.obiter.tech`.

For the marketing site, set `VITE_API_ORIGIN` to the API hostname at build time. If the marketing frontend calls the API directly across origins, set `OBITER_MARKETING_ORIGIN` on the API service to the marketing site origin.
