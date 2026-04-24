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

## Implementation Decisions

These decisions are binding for Phase 0 unless replaced by a documented architectural decision.

- Electron is the desktop target.
- TanStack Start, TanStack Router, and TanStack Query are the shared app foundation.
- API implementation should use Hono or Fastify. Choose one before M0.2 and document it in the service README.
- `better-auth` owns auth primitives.
- PostgreSQL is the source of truth for hosted application data.
- Redis and BullMQ are used for hosted background job orchestration.
- Hetzner Object Storage is the hosted object store.
- `artifacts` is the canonical implementation term. User-facing copy may call specific artifacts reports.

## Shared Package Boundaries

Initial package responsibilities:

- `packages/contracts`: shared TypeScript types, enums, and Zod schemas for API-facing data.
- `packages/ui`: reusable UI primitives, tokens, and base styling.
- `packages/app-shell`: shared layout, route-facing views, and shell data integration.
- `packages/database`: schema and migrations once persistence begins.
- `packages/config`: shared environment parsing once services are added.

Application packages should not duplicate API contracts that belong in `packages/contracts`.

## Configuration

Before M0.2, define environment variables for:

- database URL
- auth secret
- web app origin
- desktop callback or deep-link origin if used
- object storage endpoint, region, bucket, access key, and secret
- Redis URL

Configuration must fail loudly when required production values are missing.

## Upload And Storage Flow

Phase 0 may begin with API-mediated uploads for speed, then move to presigned uploads if needed.

Required behavior regardless of transport:

- compute and store `content_sha256`
- create a logical document and immutable version
- store original filename as metadata
- avoid original filename in object keys
- create an audit log entry
- queue extraction or processing work where applicable
- expose processing status to the UI

## Jobs And Processing

Use BullMQ for hosted background work.

Minimum job categories:

- document text extraction
- artifact generation
- cleanup or retry tasks where needed

Job behavior:

- jobs must be idempotent by document version or artifact id
- failed jobs must update status to `failed`
- failure reasons must be safe for UI display
- retries must not create duplicate versions or artifacts

## Audit Logging

Audit logging starts with Phase 0 mutating flows.

Rules:

- audit records are append-only
- every document upload, version creation, soft delete, and artifact download is audited
- audit metadata stores identifiers and safe operational context, not raw document contents
- audit failures in legal-critical flows should fail loudly unless explicitly documented otherwise

## Desktop Cache And Offline Queue

Desktop V1 offline support requires:

- the app opens without network
- cached matters and document metadata are readable offline
- queued uploads and edits persist locally
- reconnect sync does not silently overwrite server state
- conflicts create new document versions

Desktop cache requirements:

- encrypted at rest
- no raw auth secrets in ordinary app storage
- cache records include sync state
- local-only work is visibly marked in the UI

The local persistence technology is not fixed by this document. Choose it when implementing M0.4 and document the choice before adding production code.

## Security Defaults

- hosted data remains in the EU
- transport encryption is required outside local development
- object storage uses private buckets
- app-managed encryption should be added for especially sensitive document objects when the storage layer is implemented
- local desktop cache encryption is mandatory before real client documents are used in desktop private beta
- external AI/model calls must not receive unredacted matter documents by default

## UI Requirements

The Phase 0 shell must show:

- authenticated user and organisation context
- matter list
- matter detail
- document list
- document status
- artifact list
- clear offline/local/sync state in desktop where applicable

Loading states must say what is happening. Failure states must give a concrete next step where one exists.

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

## Not Yet Phase 0

Do not implement these before the Phase 0 foundation is stable:

- Atlas corpus ingestion
- Redact detection logic
- Verify legal checks
- Research answer generation
- benchmark runner
