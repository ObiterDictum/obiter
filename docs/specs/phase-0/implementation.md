# Phase 0 Implementation

## Scope

- mirrored web and Electron product shells
- auth with `better-auth`
- organisation and user model
- matter creation and matter views
- document upload and storage
- immutable document versioning
- processing state and artifact retrieval
- encrypted local desktop cache
- offline queue and reconnect sync behavior
- audit logging

## Build Steps

1. define monorepo package boundaries and shared TypeScript contracts
2. scaffold web app and Electron app around the same React application model
3. integrate `better-auth`
4. implement organisation, user, matter, document, and document-version tables
5. implement upload flow and Hetzner Object Storage integration
6. implement background job orchestration, audit logging, and status tracking
7. implement desktop encrypted cache and offline queue behavior
8. implement artifact model and retrieval screens

## Stack

- React
- TanStack Start
- TanStack Router
- TanStack Query
- Electron
- Node.js
- TypeScript
- `better-auth`
- PostgreSQL
- Redis
- BullMQ
- Hetzner Object Storage

## Delivery Rule

Build the shell once and share it across web and Electron. Do not maintain two divergent frontends.

## Product Rules

- desktop is the primary serious workspace
- auth supports email/password and magic link
- desktop sign-in is embedded, not browser-handoff based
- one user belongs to one organisation in the initial model
- invites can be added later without reworking identity foundations
