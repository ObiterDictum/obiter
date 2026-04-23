# Roadmap

## Purpose

This roadmap turns the planning docs into a concrete execution order for a solo-founder build.

The planning model is:

- milestones for roadmap
- tickets for execution
- no sprint-heavy process

## Build Order

### Milestone 0.1: Shared App Shell

- scaffold shared React app foundations
- bootstrap `apps/web`
- bootstrap `apps/desktop`
- wire TanStack Router and TanStack Query
- establish shared UI and shared type packages

Outcome:

- web and Electron both run from one shared product model

### Milestone 0.2: Auth And Organisation Foundation

- integrate `better-auth`
- support email/password and magic link
- implement embedded desktop auth flow
- create `organisations`, `users`, and `sessions`
- support single-organisation user model
- support roles: `owner`, `admin`, `member`

Outcome:

- authenticated product shell with org-aware identity

### Milestone 0.3: Matter And Document Foundation

- create matter model
- support primary and secondary jurisdictions
- add legal domain support
- implement document upload
- implement immutable document versions
- implement soft delete behavior

Outcome:

- matters and versioned documents work end to end

### Milestone 0.4: Storage, Jobs, Audit, And Offline

- connect Hetzner Object Storage
- add Redis and BullMQ
- implement processing status model
- implement audit logs
- implement encrypted local desktop cache
- implement offline queue and reconnect sync
- implement artifact retrieval plumbing

Outcome:

- stable Phase 0 foundation

### Milestone 1.1: Atlas

- define legal schema
- implement citation normalization
- ingest UK Supreme Court corpus
- ingest Court of Appeal corpus
- ingest selected legislation
- support authority resolution and search

Outcome:

- authoritative source substrate exists

### Milestone 1.2: Redact

- integrate local desktop redaction path
- integrate hosted redaction path
- build review UI
- support pseudonymised and hard-redacted outputs

Outcome:

- privacy workflow exists

### Milestone 1.3: Verify

- implement authority existence checks
- implement citation resolution checks
- implement quote mismatch detection
- build findings UI
- export verification artifacts

Outcome:

- trust workflow exists

### Milestone 1.35: Verify Advanced

- implement proposition extraction
- implement proposition-to-authority support analysis
- classify supported, weak, contradicted, and review-required claims
- extend findings UI for proposition support results

Outcome:

- Verify reaches the full intended trust standard

### Milestone 1.4: Research

- implement legal search flow
- implement evidence viewer
- add AI-assisted synthesis and summaries
- run verification against generated outputs

Outcome:

- source-bound research experience exists

## Start Here

If implementation begins immediately, the first work should be:

1. `apps/web` and `apps/desktop` app shell bootstrap
2. shared package boundaries
3. `better-auth` integration
4. Phase 0 schema implementation

That is the shortest path to a foundation the rest of the system can build on.
