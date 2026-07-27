# Phase 0 — Codex Implementation Brief

> Give this to Codex CLI as the goal. It contains everything needed to
> complete the remaining Phase 0 milestones. Start with Milestone 0.3,
> then 0.4. Read the dependency files listed below first.

## Start Here

Before writing any code, read these files in order:

1. `docs/architecture.md` — stack, monorepo layout, conventions
2. `RULES.md` — coding standards
3. `TESTING.md` — test expectations
4. `PR.md` — PR template and style
5. `docs/guide.md` §8 — full data model
6. Existing patterns:
   - `services/api/src/app.ts` — route structure, error handling, middleware
   - `services/api/src/database.ts` — DB query pattern (Pool, raw SQL)
   - `services/api/src/auth.ts` — auth integration pattern
   - `services/api/src/env.ts` — env config pattern
   - `packages/contracts/src/` — Zod schema pattern for request/response types
   - `packages/database/migrations/0001_phase_0_2_auth.sql` — migration style

## Current State

### ✅ Complete

- pnpm workspace + TypeScript base config
- `apps/web` — TanStack Start with Router, Query, SSR
- `apps/desktop` — Electron via electron-vite
- `packages/app-shell` — ObiterSidebar, shell layout, sign-in view
- `packages/ui` — Card, AppFrame, MetricTile, StatusPill, EmptyState
- `packages/contracts` — Zod schemas: auth, matters, documents, artifacts
- Hono API service with CORS, env validation, error handling
- better-auth (email/password + magic link, audit hooks)
- PostgreSQL migration: organisations, users, sessions, accounts, verifications, audit_logs, beta_access_grants
- `GET /api/health`, `GET /api/me`, `/api/auth/*` proxy
- Sign-in page (password + magic link, dev bypass)
- Audit logging (appendAuditLog, sign-in/sign-out events, audit_logs table)
- Matter and document routes scaffolded (matters/index.tsx, matters/$matterId.tsx)
- Contracts for MatterRecord, MatterDocumentSummary exist

### ❌ Need to Build

**Milestone 0.3 — Matter & Document CRUD**

| Piece                                        | Files                                                           |
| -------------------------------------------- | --------------------------------------------------------------- |
| Matter CRUD API endpoints                    | `services/api/src/routes/matters.ts` (new)                      |
| Document upload/versioning API               | `services/api/src/routes/documents.ts` (new)                    |
| DB operations for matters                    | Add to `services/api/src/database.ts`                           |
| DB operations for documents                  | Add to `services/api/src/database.ts`                           |
| Migration: matters + matter_documents tables | `packages/database/migrations/0002_phase_0_3_matters.sql` (new) |

**Milestone 0.4 — Storage, Jobs, Audit & Offline**

| Piece                          | Files                                        |
| ------------------------------ | -------------------------------------------- |
| Hetzner Object Storage client  | `services/api/src/storage.ts` (new)          |
| Redis + BullMQ setup           | `services/worker/src/` (new service)         |
| Artifact retrieval endpoints   | `services/api/src/routes/artifacts.ts` (new) |
| Desktop encrypted cache        | `apps/desktop/src/cache.ts` (new)            |
| Offline queue + reconnect sync | `apps/desktop/src/sync.ts` (new)             |

---

## Milestone 0.3 — Matter & Document CRUD

### Migration: `packages/database/migrations/0002_phase_0_3_matters.sql`

```sql
-- Matters
create table matters (
  id text primary key default gen_random_uuid()::text,
  organisation_id text not null references organisations(id) on delete cascade,
  name text not null,
  client_reference text,
  jurisdiction text not null default 'england-wales',
  default_redaction_policy text,
  storage_mode text not null default 'cloud',
  is_deleted boolean not null default false,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_matters_organisation on matters(organisation_id, is_deleted);

-- Matter Documents
create table matter_documents (
  id text primary key default gen_random_uuid()::text,
  matter_id text not null references matters(id) on delete cascade,
  version integer not null default 1,
  uploaded_by text not null references users(id),
  filename text not null,
  file_type text,
  object_key text not null,
  text_object_key text,
  sha256 text not null,
  page_count integer,
  document_status text not null default 'uploading',
  contains_unredacted_data boolean not null default false,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_documents_matter on matter_documents(matter_id, version, is_deleted);
```

### API: `services/api/src/routes/matters.ts`

Create a new route module. Pattern to follow:

```typescript
import { Hono } from 'hono'
import type { Pool } from 'pg'
// ... existing patterns from app.ts

export function createMatterRoutes(pool: Pool) {
  const app = new Hono()

  // POST /api/matters — create matter
  // GET /api/matters — list matters (by organisation, not deleted)
  // GET /api/matters/:id — get matter by id
  // PATCH /api/matters/:id — update matter (name, ref, jurisdiction)
  // DELETE /api/matters/:id — soft delete
  // PATCH /api/matters/:id/restore — restore from trash

  return app
}
```

**Endpoints:**

| Method | Path                     | Auth     | Body/Params                                                                            | Returns           |
| ------ | ------------------------ | -------- | -------------------------------------------------------------------------------------- | ----------------- |
| POST   | /api/matters             | Required | { name, organisation_id, client_reference?, jurisdiction?, default_redaction_policy? } | MatterRecord      |
| GET    | /api/matters             | Required | ?organisation_id (from session user's org)                                             | MatterRecord[]    |
| GET    | /api/matters/:id         | Required | —                                                                                      | MatterRecord      |
| PATCH  | /api/matters/:id         | Required | { name?, client_reference?, jurisdiction? }                                            | MatterRecord      |
| DELETE | /api/matters/:id         | Required | —                                                                                      | { success: true } |
| PATCH  | /api/matters/:id/restore | Required | —                                                                                      | MatterRecord      |

### API: `services/api/src/routes/documents.ts`

**Endpoints:**

| Method | Path                             | Auth     | Body/Params                | Returns                                   |
| ------ | -------------------------------- | -------- | -------------------------- | ----------------------------------------- |
| POST   | /api/matters/:matterId/documents | Required | multipart: file + metadata | MatterDocumentSummary                     |
| GET    | /api/matters/:matterId/documents | Required | —                          | MatterDocumentSummary[]                   |
| GET    | /api/documents/:id               | Required | —                          | MatterDocumentSummary (with download URL) |
| DELETE | /api/documents/:id               | Required | —                          | { success: true } (soft delete)           |

**Document flow:**

1. Upload → store file in local `./uploads/` (dev) or S3-compatible storage
2. Compute SHA256
3. Insert `matter_document` record with `document_status = 'uploading'`
4. If version 2+, increment version number (immutable — old version stays)
5. Set status to `'ready'` after storage confirms

For **development mode** (no Hetzner OBJ yet), store files to `./uploads/{matter_id}/{document_id}/` locally. The contracts already have the shape. Wire up real S3 in Milestone 0.4.

### DB Operations: Add to `services/api/src/database.ts`

Add these functions following the existing pattern (raw SQL, typed):

- `createMatter(pool, input)` → MatterRecord
- `listMatters(pool, organisationId)` → MatterRecord[]
- `getMatter(pool, matterId)` → MatterRecord | null
- `updateMatter(pool, matterId, input)` → MatterRecord
- `softDeleteMatter(pool, matterId)` → void
- `restoreMatter(pool, matterId)` → void
- `createDocument(pool, input)` → MatterDocumentSummary
- `listDocuments(pool, matterId)` → MatterDocumentSummary[]
- `getDocument(pool, documentId)` → MatterDocumentSummary | null
- `softDeleteDocument(pool, documentId)` → void

### Wire Routes into App

In `services/api/src/app.ts`, import and mount:

```typescript
import { createMatterRoutes } from './routes/matters'
import { createDocumentRoutes } from './routes/documents'

// After existing routes:
app.route('/', createMatterRoutes(pool))
app.route('/', createDocumentRoutes(pool))
```

### Contracts: Check `packages/contracts/src/`

The schemas `MatterRecord` and `MatterDocumentSummary` should already exist. If any fields are missing from the request types, add Zod schemas:

- `CreateMatterInput` — name (required), organisation_id (derived from session), client_reference (optional), jurisdiction (default), default_redaction_policy (optional)
- `UpdateMatterInput` — all optional
- `CreateDocumentInput` — filename, file_type, sha256, page_count (optional)
- `MatterListParams` — organisation_id, include_deleted (optional boolean)

### Verify: Milestone 0.3

1. Run migration → tables created
2. Boot API → `GET /api/health` returns ok
3. Create matter via POST → returns MatterRecord
4. List matters → returns array
5. Get matter by id → returns record
6. Update matter → fields changed
7. Soft delete → lists no longer include it
8. Restore matter → list includes it again
9. Upload document → returns summary
10. List documents → shows uploaded doc
11. Delete document → soft-deleted
12. Run `pnpm test` (API tests) — all pass
13. Run `pnpm typecheck` — no errors

---

## Milestone 0.4 — Storage, Jobs, Audit & Offline

> Build this after Milestone 0.3 is complete and verified.

### Hetzner Object Storage: `services/api/src/storage.ts`

Hetzner is S3-compatible. Use the `@aws-sdk/client-s3` package.

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

export function createStorageClient(env: ApiEnv) {
  return new S3Client({
    region: 'eu-central-1', // Hetzner region
    endpoint: env.objectStorageEndpoint, // e.g. https://fsn1.your-objectstorage.com
    credentials: {
      accessKeyId: env.objectStorageKeyId,
      secretAccessKey: env.objectStorageKeySecret,
    },
    forcePathStyle: true, // Required for S3-compatible
  })
}

// Functions:
// uploadFile(client, bucket, key, body, contentType) → { key, etag }
// getDownloadUrl(client, bucket, key, expiresIn) → string (pre-signed URL)
// deleteFile(client, bucket, key) → void
```

**Env vars to add** (production only, dev uses local files):

```
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORATE_KEY_ID=
OBJECT_STORAGE_KEY_SECRET=
OBJECT_STORAGE_BUCKET=
```

For dev, fall back to local filesystem storage in `./uploads/`.

### Redis + BullMQ: `services/worker/`

Create a new workspace package at `services/worker/`. Use the existing `services/worker/README.md` as a starting point.

**package.json** (add to workspace):

```json
{
  "name": "@obiter/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@obiter/contracts": "workspace:*",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "pg": "^8.20.0"
  }
}
```

**Job types:**

- `document.text-extraction` — extract text from uploaded document → store text_object_key
- `document.thumbnail` — generate thumbnail for preview
- `matter.export` — package matter files for download

**Worker pattern:**

```typescript
import { Worker } from 'bullmq'

const worker = new Worker(
  'document-processing',
  async (job) => {
    switch (job.name) {
      case 'text-extraction':
        // Read file from storage, extract text, update DB
        break
      case 'thumbnail':
        // Generate preview thumbnail
        break
    }
  },
  { connection: { host: 'localhost', port: 6379 } },
)
```

### Audit: Extend `services/api/src/database.ts`

Add more audit event types beyond auth events:

- `matter.created`
- `matter.updated`
- `matter.deleted`
- `matter.restored`
- `document.uploaded`
- `document.deleted`
- `document.text-extracted`

The `appendAuditLog` function already supports this — pass the right entity_type/action.

### Desktop Offline: `apps/desktop/src/cache.ts`

Use an embedded SQLite (via `better-sqlite3` or `sql.js`) for local cache:

**Schema in local cache:**

- `matters` — cached matter records
- `documents` — cached document metadata
- `pending_changes` — offline mutation queue

**`sync.ts`:**

- On reconnect: replay `pending_changes` queue in order
- Conflict resolution: last-write-wins with server timestamp check
- Pull latest matter/document list from API

### Verify: Milestone 0.4

1. Upload file → stored locally (dev) / Hetzner (prod)
2. Job enqueued to BullMQ → worker picks it up
3. Audit log records document event
4. Desktop app caches data locally
5. Desktop works offline with cached matter list
6. Queue executes on reconnect

---

## Testing & Quality

All tests use `vitest`. Follow existing patterns in `services/api/src/app.test.ts` and `services/api/src/env.test.ts`.

**Guidelines:**

- Unit test each route handler with mocked pool
- Test error cases: missing auth, not found, validation errors
- Test soft-delete behaviour (still accessible with flag, excluded by default)
- Test version increment on document re-upload
- No test should depend on real PostgreSQL — use a test pool or mock

## Boundaries (Do Not Do)

- ❌ Do NOT create Azure/OpenAI/Anthropic API clients here (Phase 1 Atlas work)
- ❌ Do NOT create Meilisearch index schemas (gated on TNA licence)
- ❌ Do NOT build citation parser, legal schema types, or search client (Phase 1 pre-work)
- ❌ Do NOT modify the existing auth, app-shell, or contracts packages unless adding missing fields for matter/document routes
- ❌ Do NOT change the existing migration (`0001`)

## Quick Start (Local Dev on Windows)

```powershell
# Prerequisites: PostgreSQL 16 running, Redis 7 running
cd \path\to\obiter
pnpm install

# Create .env:
# DATABASE_URL=postgres://postgres:***@localhost:5432/obiter
# BETTER_AUTH_SECRET=*** rand -base64 32>
# NODE_ENV=development

# Run migration
psql -U postgres -d obiter -f packages/database/migrations/0001_phase_0_2_auth.sql
psql -U postgres -d obiter -f packages/database/migrations/0002_phase_0_3_matters.sql

# Start API
pnpm dev:api     # http://localhost:8787

# Start web (separate terminal)
pnpm dev:web     # http://localhost:3000

# Run tests
pnpm test
pnpm typecheck
```
