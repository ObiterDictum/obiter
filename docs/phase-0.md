# Phase 0 Foundation

## Purpose

Phase 0 builds the product shell before legal intelligence modules are layered into it.

This is the shared substrate for Atlas, Verify, Redact, and Research. If this layer is unstable, Phase 1 work slows down and gets rewritten.

## Phase 0 Outcome

By the end of Phase 0, Ormont should have:

- a web application shell
- an Electron desktop application shell
- mirrored core product flows across web and desktop
- authentication and session handling
- organisation, user, and matter models
- document upload and storage
- background jobs and processing status
- artifact storage and retrieval plumbing
- shared design system, routing, and API contracts
- audit logging
- offline-capable desktop workflows
- local encryption for desktop cache and sensitive local artifacts

## Product Goal

The user should be able to:

1. sign in
2. create or access an organisation
3. create a matter
4. upload a document into that matter
5. see processing status
6. access generated outputs and downloadable artifacts

## Product Positioning

Phase 0 is desktop-first.

- the Electron app is the primary serious workspace
- the web app mirrors the same core product model
- desktop-only capabilities are allowed where local processing or trust boundaries matter

The initial MVP user is:

- solo practitioners
- small firms

## User And Org Model

Phase 0 should start with:

- one user belongs to one organisation
- roles: `owner`, `admin`, `member`
- multi-session support from day 1
- invite-only closed beta access

Invitations and broader team-management flows should be easy to add later, but they do not need to block the first usable build.

## Stack Direction

### Frontend

- React
- TanStack Start
- TanStack Router
- TanStack Query
- TanStack Table
- TanStack Virtual where needed
- Tailwind
- Zustand
- Zod

### Desktop

- Electron
- shared React application with the web product
- Electron main process for filesystem access, secure local integrations, and desktop packaging

### Backend

- Node.js
- TypeScript
- Hono or Fastify
- `better-auth`
- PostgreSQL hosted on Ormont infrastructure
- Redis
- BullMQ
- Hetzner Object Storage

## Security Defaults

Security is a first-order product requirement, not a later hardening pass.

The default platform posture should be:

- transport encryption everywhere
- encrypted volumes and encrypted storage at rest
- app-managed encryption for especially sensitive document objects
- local desktop cache encryption from day 1
- audit logs from Phase 0
- soft delete by default, with hard deletion as an explicit administrative or support path

The compliance direction should align with:

- UK GDPR / GDPR
- ICO-style accountability and auditability
- ISO 27001-friendly controls

## Offline Scope

Desktop V1 offline support means:

- app opens offline
- cached matters and documents are readable offline
- local document work is possible offline
- local redaction can run offline on desktop
- edits and uploads queue for sync after reconnect
- Atlas search and cloud-backed research remain online-only

## Mirrored Web And Desktop

The web app and Electron app should not be treated as separate products.

They should share:

- routes where feasible
- UI components
- validation models
- API contracts
- matter and document workflows

They should differ only where desktop capabilities justify it, such as:

- native file picking
- local export helpers
- local encrypted storage
- local redaction
- future local-first processing

## Sync And Versioning

Phase 0 should use immutable document versions.

- every new upload creates a new immutable version record under one logical document
- sync conflicts become new versions
- the system must never silently overwrite legal work
- deleted documents are soft-deleted by default

## Phase 0 Modules

### App Shell

- global layout
- navigation
- route structure
- session bootstrapping
- organisation and matter switching

### Auth

- sign in
- sign out
- session lifecycle
- organisation-aware identity
- email/password
- magic link
- embedded desktop sign-in UI
- multi-session support

### Matter Workspace

- create matter
- list matters
- matter overview
- document upload
- document version history
- document status tracking
- artifact listing

### Audit And Activity

- sign-in and session activity logging
- matter creation and update logging
- document upload, download, and delete logging
- artifact generation and access logging

### Storage

- uploaded file storage
- artifact storage
- document metadata persistence
- object-key strategy
- encryption-aware storage rules

### Jobs And Status

- background queue wiring
- document status model
- processing state polling
- failure handling

## Out Of Scope

Phase 0 does not include:

- legal corpus ingestion
- legal verification logic
- legal redaction logic
- source-bound research generation
- multi-tenant enterprise admin depth
- full collaboration tooling
- enterprise on-prem deployment optimization

## Acceptance Criteria

Phase 0 is complete when:

- a user can authenticate
- auth supports email/password and magic link
- a user can create and open a matter
- a user can upload a document into that matter
- document uploads produce immutable versions
- the UI shows processing state correctly
- artifacts can be stored, downloaded, and audited
- desktop can open and work with cached data offline
- local desktop cache is encrypted
- sync reconnect queues work without silent overwrite
- the same core workflow works on web and Electron
