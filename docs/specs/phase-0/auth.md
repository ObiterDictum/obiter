# Phase 0 Auth

## Auth Stack

- `better-auth`
- PostgreSQL-backed user and session persistence
- secure cookie or token session handling as appropriate to web and desktop

## Must Build

- sign in
- sign out
- session persistence
- protected routes
- organisation-aware user context

## Desktop Note

Electron should reuse the same auth backend and API contracts as the web app. Desktop-specific session handling should not fork the identity model.
