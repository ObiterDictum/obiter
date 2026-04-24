# Phase 0 Auth

## Purpose

Phase 0 auth establishes identity, sessions, organisation context, and protected routes for both web and Electron.

## Auth Stack

- `better-auth`
- PostgreSQL-backed user and session persistence
- secure cookie or token session handling as appropriate to web and desktop
- shared API contracts for web and Electron

## Must Build

- sign in
- sign out
- email/password auth
- magic link auth
- session persistence
- session expiry handling
- protected routes
- organisation-aware user context
- closed-beta access control

## Organisation Bootstrap

Phase 0 starts with one user belonging to one organisation.

Initial bootstrap rules:

- the first accepted user for an organisation is `owner`
- later users can be `admin` or `member`
- invitations can be added later, but the schema must not assume public self-serve signup
- closed beta users must be allowlisted or provisioned by an admin path

## Session Model

Web:

- use secure, HTTP-only cookies where supported by `better-auth`
- cookies must be `Secure` outside local development
- use `SameSite=Lax` or stricter unless auth flow requirements force otherwise

Electron:

- reuse the same auth backend and API contracts
- use embedded sign-in UI
- do not depend on browser handoff for the core desktop sign-in path
- store session material only through the chosen secure desktop storage path
- never store raw passwords locally

The desktop session implementation may differ mechanically from web cookies, but it must resolve to the same authenticated API identity and organisation context.

## Magic Link Handling

Magic link support is required for Phase 0.

Rules:

- links must expire
- links must be single-use where supported
- desktop magic-link completion must land back in the embedded desktop auth flow
- failed or expired links must show a clear recoverable state

## Protected Routes

Protected route loading must verify:

- authenticated session
- user record exists
- user has an organisation
- organisation is active

Unauthenticated users go to sign-in. Authenticated users without a valid organisation should go to a setup or support state, not a broken shell.

## Current User Contract

Every authenticated app shell needs:

- user id
- email
- name
- role
- organisation id
- organisation name
- organisation plan

This should be exposed through `GET /api/me` or an equivalent shared query.

## Sign Out And Revocation

Sign out must:

- invalidate the active session server-side where supported
- clear local web or desktop session material
- leave local encrypted matter cache intact but inaccessible without a valid local unlock strategy

Future session-management UI should be possible without changing the session model.

## Audit Requirements

Audit at minimum:

- successful sign-in
- sign-out
- failed sign-in if safe and useful without leaking credentials
- session revocation where implemented

Audit metadata must not include passwords, magic-link tokens, or full auth secrets.

## Out Of Scope

Phase 0 auth does not need:

- SSO
- SAML
- multi-organisation switching
- enterprise SCIM
- full team invitation management
