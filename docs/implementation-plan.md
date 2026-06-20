# Ormont Phase 0 — Implementation Plan

## Strategy

Two parallel tracks:

- **Track A:** TNA licence application (free, takes weeks — start the clock NOW)
- **Track B:** Build Phase 0 code while waiting for the licence

The licence gates bulk case law ingestion into Meilisearch. Without it, we can't do Atlas search. But Phase 0 (matters, documents, storage, jobs) has no dependencies — build it now so search has a home when the licence arrives.

---

## Infrastructure Decisions

| Decision | Choice |
|----------|--------|
| **Database** | PostgreSQL 16 (local dev → Hetzner VPS production) |
| **Transactional email** | Cloudflare Email Workers (magic links, notifications) |
| **Object storage** | Hetzner Object Storage (S3-compatible) |
| **Queue** | Redis + BullMQ |
| **Search** | Meilisearch |
| **Auth** | better-auth (email/password + magic link) |

### Cloudflare Email Setup

The API sends magic links via a webhook (`ORMONT_MAGIC_LINK_WEBHOOK_URL`). In production, this is a Cloudflare Worker that calls the [Send Email API](https://developers.cloudflare.com/email-routing/email-workers/).

Files to create:
- `infra/cloudflare/email-worker/` — Cloudflare Worker for transactional email
- `infra/cloudflare/wrangler.toml` — Worker config

In dev mode, magic links just log to console (no email sent).

---

## Timeline

### Pre-Step — Get The Stack Running

Before any new feature code, the existing stack must actually run.

| Day | Task | Files | Deliverable |
|-----|------|-------|-------------|
| **0** | **Install PostgreSQL 16 + create `ormont` DB** | — | `psql ormont` works |
| **0** | **Create `.env`** | `.env` | DATABASE_URL, BETTER_AUTH_SECRET, dev URLs |
| **0** | **Run migration 0001** | `packages/database/migrations/0001_phase_0_2_auth.sql` | Auth tables exist |
| **0** | **Start API** | `pnpm dev:api` | `GET /api/health` → `{"status":"ok"}` |
| **0** | **Test sign-in** | Dev magic link logs to console | Can sign in and see the shell |
| **0** | **Cloudflare Email Worker** | `infra/cloudflare/email-worker/src/index.ts` | Worker deployed, magic links send |

### Week 1 — Foundation

| Day | Task | Files | Deliverable |
|-----|------|-------|-------------|
| **1** | **Submit TNA licence application** | [TNA apply page](https://caselaw.nationalarchives.gov.uk/apply-for-a-licence) | Clock starts (free, weeks turnaround) |
| **1** | **Migration 0002: matters + documents** | `packages/database/migrations/0002_phase_0_3_matters.sql` | `matters` + `matter_documents` tables exist |
| **2** | **DB operations** | Add to `services/api/src/database.ts` | `createMatter`, `listMatters`, `getMatter`, `updateMatter`, `softDeleteMatter`, `restoreMatter`, `createDocument`, `listDocuments`, `getDocument`, `softDeleteDocument` |
| **3** | **Matter API routes** | `services/api/src/routes/matters.ts` | POST/GET/GET:id/PATCH/DELETE/PATCH:restore |
| **4** | **Document API routes** | `services/api/src/routes/documents.ts` | POST upload/GET list/GET download/DELETE |
| **5** | **Wire routes + verify** | `services/api/src/app.ts` | Full M0.3 verified: create matter → upload doc → list → delete → restore |

### Week 2 — Production Readiness

| Day | Task | Files | Deliverable |
|-----|------|-------|-------------|
| **6** | **Storage client** | `services/api/src/storage.ts` | S3-compatible (Hetzner OBJ) with local fs fallback |
| **7** | **Redis + BullMQ worker** | `services/worker/src/index.ts`, `pnpm-workspace.yaml` | text-extraction + thumbnail + export jobs |
| **8** | **Artifact routes** | `services/api/src/routes/artifacts.ts` | Download endpoints for processed artifacts |
| **9** | **Desktop offline** | `apps/desktop/src/cache.ts`, `apps/desktop/src/sync.ts` | SQLite local cache + reconnect sync |
| **10** | **Verify M0.4** | Full stack test | Upload → job queued → processed → artifact downloadable |

### Week 3 — Search

| Day | Task | Files | Deliverable |
|-----|------|-------|-------------|
| **11** | **Meilisearch setup** | `services/search/` | Running Meilisearch instance, index schema |
| **12** | **Ingest legislation.gov.uk** (no licence needed) | `services/atlas-ingestor/` | Searchable legislation corpus |
| **13** | **Search API** | `services/api/src/routes/search.ts` | Search endpoint returning ranked results |
| **14** | **Search UI** | `apps/web/src/routes/search/` | Basic search page with results display |
| **—** | **TNA licence arrives** (hopefully) | — | Ingest UK case law corpus into Meilisearch |

### Week 4 — Revenue

| Day | Task | Files | Deliverable |
|-----|------|-------|-------------|
| **15** | **Beta pricing page** | `apps/web/src/routes/pricing/` | Founding member £X/month plan |
| **16** | **Invite solo practitioners** | Outreach draft | 10-20 targeted invites |
| **17** | **Launch** | — | First beta users onboarding |

---

## What Gets Deprioritised

| Item | Why |
|------|-----|
| Sidebar Base UI refactor | Polish on already-working UI. Do after Phase 0 ships. |
| Desktop offline encryption | Scope for later. Ship without encryption first. |
| Verify Advanced (propositions) | Phase 1.5 work. Not needed for beta. |
| Redact module | Phase 1.2. Not needed for beta. |

## Risk Register

| Risk | Mitigation |
|------|-----------|
| TNA licence rejected or delayed | Start with legislation.gov.uk corpus (OGL licence, no restriction). |
| Codex CLI generates incompatible code | Review each PR against `RULES.md` before merge. |
| Karl burns out from solo build | Daily accountability loop. One task per day. Weekends optional. |
