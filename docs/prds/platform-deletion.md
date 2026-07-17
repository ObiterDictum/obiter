# Platform Deletion

> ## Implementation status (verified against the codebase, July 2026)
>
> Matters and matter documents already had soft-delete on `dev` before this work
> (`deleted_at`, single-row `softDeleteMatter`/`softDeleteDocument`,
> `DELETE /api/matters/:id` and `/api/documents/:id`, a `PATCH …/restore` path
> for matters, `includeDeleted` query on list/get, and `*.delete`/`matter.restore`
> audit actions). **This PR extends that capability rather than building it from
> scratch.** It adds redaction-run soft-delete, a transactional cascade with
> provenance, `deleted_by` on all three tables, manage-role authorization on every
> deletion and restore path, and a defined access shape for the audit report of a
> deleted run.

## Summary

Deletion in Obiter must be a designed capability, not a bolted-on column. The
audience is law firms: a legal tool must be able to demonstrate what existed, who
removed it, and when, and accidental-deletion recovery must matter more than the
disk space the rows occupy. This PRD captures the rulings that govern deletion
across matters, documents, and redaction runs, and records the exact behaviour
shipped by the implementation so a future contributor does not relitigate it.

## Product Principles

- **Soft delete, uniformly.** Deleted entities vanish from every product surface
  and every API read path, but their rows persist. Rationale: demonstrate what
  existed; recover from accidental deletion; satisfy retention expectations
  without a separate erasure pipeline.
- **The audit trail is append-only and survives deletion.** Every deletion writes
  a `*.delete` audit row; audit rows are never deleted, including for deleted
  entities. A deleted redaction run's audit report remains internally retrievable.
- **Deletion is a privileged action.** Only `owner` and `admin` roles may delete
  or restore. This is the first real authorization distinction in the product and
  is enforced server-side — UI hiding is not authorization.
- **Cascade is explicit and provenance-tracked.** Deleting a parent removes its
  children; restoring a parent revives only the children that parent's deletion
  took down, never ones the user deleted individually beforehand.

## Goals

1. **Redaction-run soft-delete.** `redaction_runs` gain `deleted_at`/`deleted_by`;
   a `DELETE /api/redaction-runs/:runId` endpoint soft-deletes a standalone run;
   every list and get path excludes soft-deleted runs.
2. **Transactional cascade with provenance.** Deleting a matter soft-deletes its
   documents and their runs; deleting a document soft-deletes its runs. Restore
   revives only the children the same cascade took down.
3. **`deleted_by` on every soft-deletable entity.** Matters, matter documents, and
   redaction runs all record who removed them, not just when.
4. **Manage-role authorization.** A reusable, server-side role check gates every
   delete and restore route (and the deleted-run audit endpoint) to `owner`/`admin`.
5. **Defined access shape for a deleted run's audit report.** Direct `GET` of a
   deleted run returns 404; the audit sub-resource stays retrievable by id for the
   org's owner/admin, with no UI listing deleted runs.

## Non-Goals

- **Hard delete / purge / true erasure.** Data-subject (erasure) requests require
  a retention policy conversation and a separate physical-cleanup path. Out of
  scope. Rows persist; only reachability changes.
- **Physical cleanup of stored objects.** Source, text, and output files in object
  storage are not removed in this phase. They become unreachable once the rows are
  soft-deleted; physical deletion is part of the future purge work.
- **Restore UI.** Restore remains an operator/server-side action. A restore
  endpoint exists (and cascades), but no UI surfaces it.
- **Retention policy.** No automatic expiry, retention windows, or legal-hold
  semantics. Deferred.
- **Search/legal-source surfaces.** Internal `includeDeleted` plumbing stays within
  matters/documents/redaction-runs. Org-external search and legal-source surfaces
  are untouched.

## Rulings (as shipped)

### 1. Soft delete, uniformly

`deleted_at` and `deleted_by` columns on `matters`, `matter_documents`, and
`redaction_runs`. Deleted entities vanish from every list, detail, and read path
and from every API read surface, but rows persist. Rationale: a legal tool must be
able to demonstrate what existed; accidental-deletion recovery matters more than
disk space. Hard-delete/purge (true erasure for data-subject requests) is out of
scope — see Non-Goals.

The `matters` table couples `status` and `deleted_at` via the
`matters_deleted_at_status_check` constraint (migration 0002): a row with
`deleted_at` set must carry `status = 'deleted'`, and vice versa. Matters
therefore set `status = 'deleted'` on delete and `status = 'active'` on restore
(constraint-compliant). `matter_documents` and `redaction_runs` carry no such
constraint, so they rely purely on `deleted_at` and never touch lifecycle status.

> **Known limitation, documented, not introduced here:** because matters restore
> to `status = 'active'`, a matter that was `archived` before deletion returns to
> `active` after restore. The pre-deletion status is not preserved. Fixing this
> would require altering the coupling constraint and is deferred.

### 2. The audit trail is append-only and survives deletion

Every deletion writes a `*.delete` audit row (`matter.delete`, `document.delete`,
`redaction_run.delete`) carrying entity, actor, timestamp, and request id. Audit
rows are never deleted, including for deleted entities. `audit_logs` has no
delete, truncate, or update path anywhere in the codebase.

A deleted redaction run's audit report remains internally retrievable — this is a
product guarantee, stated plainly: **direct `GET /api/redaction-runs/:runId`
returns 404 for a deleted run (consistent with list/detail exclusion), but
`GET /api/redaction-runs/:runId/audit` stays retrievable by id for the org's
owner/admin.** The audit URL for a deleted run is only reachable if the run id is
already known (from the audit log, an export, or records kept elsewhere); there is
deliberately no UI listing deleted runs. That is the designed behaviour — the 404
on the direct GET is not a bug, and documenting it here stops a future session
"fixing" it.

### 3. Role-gated: owner and admin may delete; member may not

This is the first real authorization distinction. A small reusable role check
gates every delete and restore route (and the deleted-run audit endpoint) to
`owner`/`admin`; a `member` receives `403 forbidden` with a machine-readable
code. The role field already exists on users (`owner`/`admin`/`member`) and is
exposed on the session; today everyone is an owner of their own org, so this is
forward-looking but is enforced server-side regardless. UI hiding is not
authorization — members see no delete affordance, but the API is the authority.

### 4. Cascade rules

- Deleting a matter soft-deletes its documents and their redaction runs.
- Deleting a document soft-deletes its redaction runs.
- Deleting a standalone redaction run deletes just the run.

**Provenance mechanism (no schema addition):** Postgres `now()` is
transaction-stable — every `set deleted_at = now()` within one cascade-delete
transaction yields an identical timestamp `T` on the parent and every
cascade-deleted child. Already-deleted children are skipped (`where deleted_at is
null`) and keep their older timestamp. Cascade-restore reads the parent's
`deleted_at` (`= T`) under `FOR UPDATE`, then restores only children
`where deleted_at = T`. An individually-deleted child (timestamp `T0 ≠ T`) is not
matched and stays deleted. This is why Monday-deleted-doc-A does not come back
when the matter is deleted on Tuesday and restored on Wednesday.

Output artifacts and stored objects (source/text/output files in storage) are not
physically removed in this phase. They are unreachable once the rows are
soft-deleted; physical cleanup is part of the future purge work.

### 5. Restore

A restore endpoint exists for matters (`PATCH /api/matters/:id/restore`) and
cascades with provenance as described above. Restore is an operator/server-side
action; no UI surfaces it. Restore coverage is consistent across matters,
documents, and redaction runs at the data layer (each cascade delete has a
symmetric cascade restore). A restore UI is deferred future work.

## Migration

New migration `0010_soft_delete_redaction_runs_and_deleted_by.sql`:

- `redaction_runs`: add `deleted_at timestamptz`, `deleted_by text references
users(id)`; replace the non-partial index from migration 0007 with
  `redaction_runs_organisation_created_at_live_idx`, filtered by
  `deleted_at is null`.
- `matters`: add `deleted_by text references users(id)`.
- `matter_documents`: add `deleted_by text references users(id)`.
- Backfill documents and runs left live beneath parents deleted before cascade
  support, copying the parent deletion timestamp and actor.

Column additions and index operations are guarded so the migration can be
re-run safely; existing migrations are never edited.

## API surface

- `DELETE /api/matters/:matterId` — manage-role, transactional cascade to
  documents + runs, one `*.delete` audit row per entity, 404 for cross-org /
  nonexistent / already-deleted (no existence leakage).
- `DELETE /api/documents/:documentId` — manage-role, cascade to runs, audit row(s).
- `DELETE /api/redaction-runs/:runId` — manage-role, soft-deletes the run, audit
  row. Standalone run → just the run.
- `PATCH /api/matters/:id/restore` — manage-role, cascade restore with provenance.
- Every existing read path (lists, details, document sources for runs, run
  sub-resources) excludes soft-deleted rows. The redaction audit endpoint is the
  sole exception: it remains able to return a deleted finalized run's report.

## UI

- Delete actions on matter detail, document detail, and the redaction run
  (list and review screen), each behind a confirmation dialog that states the
  cascade with real counts ("Deleting this matter also removes N documents and
  their redaction runs"), using existing `@obiter/ui` Dialog/Toast primitives.
- Members see no delete affordance; the API enforces regardless.
- After deletion, the UI navigates away sensibly and invalidates the affected
  TanStack Query caches, following the established mutation patterns.
- `@obiter/ui` is untouched; `@obiter/app-shell` is additive-only; `redact-ui`
  changes are limited to the run-delete affordance.

## Verification

Run-based, against the local API on web and dev-desktop: create → delete → verify
gone from UI and API → verify audit rows in the database. See the PR body for the
exact flows exercised and the DB-level audit-row evidence.
