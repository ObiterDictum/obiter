# Ormont API

Phase 0.2 uses Hono for the API service and `better-auth` for identity.

## Current Scope

- mounts `better-auth` at `/api/auth/*`
- enables email/password sign-in for provisioned users
- enables magic-link sign-in with hashed verification tokens
- exposes `GET /api/me` as the organisation-aware current-user contract
- records sign-out audit intent through `/api/session/sign-out-audit`

## Environment

Production must provide:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `ORMONT_WEB_ORIGIN`

Development falls back to local defaults so the service can typecheck and boot before hosted infrastructure is provisioned.
