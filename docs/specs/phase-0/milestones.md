# Phase 0 Milestones

## M0.1

- shared app shell exists
- web and Electron bootstrap successfully
- shared contracts package exports shell-facing types
- shared UI package is consumed by app shell
- shared app-shell package is consumed by web and Electron
- root build, typecheck, and tests run for the scaffold

## M0.2

- auth works
- protected routes work
- organisation context loads correctly
- email/password sign-in works
- magic-link sign-in works
- embedded desktop sign-in works
- closed-beta access control exists
- `GET /api/me` or equivalent current-user contract exists
- sign-in and sign-out are audited

## M0.3

- matter create/list/open works
- document upload works
- matters support primary jurisdiction, secondary jurisdictions, and legal domains
- uploads create immutable document versions
- soft delete works for logical documents
- document status is visible in the UI
- upload and delete actions are audited

## M0.4

- job status flows work
- artifacts can be retrieved
- Hetzner Object Storage integration exists
- Redis and BullMQ are wired for background work
- failed jobs surface safe failure states
- desktop cache is encrypted
- desktop offline queue persists work through restart
- reconnect sync creates new versions for conflicts
- artifact downloads are audited

## Done When

- the product shell is stable enough for Atlas, Verify, Redact, and Research to plug into without reworking identity, routing, storage, or matter handling

## Verification Matrix

Before marking each milestone done:

- run the relevant automated tests
- run typecheck
- build affected packages and apps
- manually exercise the primary web flow
- manually exercise the primary Electron flow when desktop behavior changed
- test the failure path for auth, upload, sync, storage, jobs, and audit behavior

Do not claim offline, encryption, audit, or immutable-version behavior complete unless it has been directly verified.
