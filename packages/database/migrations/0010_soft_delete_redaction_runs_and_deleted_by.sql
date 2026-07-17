-- 0010_soft_delete_redaction_runs_and_deleted_by.sql
--
-- Deletion capability for matters, matter_documents, and redaction_runs.
-- See docs/prds/platform-deletion.md for the product rulings.
--
-- Matters and matter_documents already carried deleted_at (migration 0002);
-- this adds the matching deleted_by (who removed the row, not just when) to
-- both, and adds soft-delete support (deleted_at + deleted_by) to
-- redaction_runs, which previously had no deletion path at all.
--
-- Column additions and the replacement index are guarded so re-running is
-- safe. The backfills only update rows that are still live.

-- redaction_runs: deletion was entirely absent before this migration.
alter table redaction_runs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text references users(id);

-- Replace the non-partial index from 0007 with a separately named live-row
-- index. Dropping the old index first keeps this migration re-runnable.
drop index if exists redaction_runs_organisation_created_at_idx;

create index if not exists redaction_runs_organisation_created_at_live_idx
  on redaction_runs (organisation_id, created_at desc)
  where deleted_at is null;

-- matters and matter_documents: deleted_at exists (0002); record the actor.
alter table matters
  add column if not exists deleted_by text references users(id);

alter table matter_documents
  add column if not exists deleted_by text references users(id);

-- Pre-0010 matter deletes could leave documents and runs live. Bring those
-- rows into the cascade while preserving the parent's timestamp and actor.
update matter_documents document
set deleted_at = matter.deleted_at,
    deleted_by = matter.deleted_by
from matters matter
where document.matter_id = matter.id
  and document.organisation_id = matter.organisation_id
  and document.deleted_at is null
  and matter.deleted_at is not null;

-- A deleted document takes precedence because it is the run's immediate
-- parent. The matter update then covers any remaining parent-linked run.
update redaction_runs run
set deleted_at = document.deleted_at,
    deleted_by = document.deleted_by
from matter_documents document
where run.document_id = document.id
  and run.organisation_id = document.organisation_id
  and run.deleted_at is null
  and document.deleted_at is not null;

update redaction_runs run
set deleted_at = matter.deleted_at,
    deleted_by = matter.deleted_by
from matters matter
where run.matter_id = matter.id
  and run.organisation_id = matter.organisation_id
  and run.deleted_at is null
  and matter.deleted_at is not null;
