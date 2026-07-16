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
-- All additions are additive (`add column if not exists`) so re-running is
-- safe. Existing migrations are not edited.

-- redaction_runs: deletion was entirely absent before this migration.
alter table redaction_runs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text references users(id);

-- Partial index mirroring matters: the common list path filters
-- `deleted_at is null`, so index only live runs.
create index if not exists redaction_runs_organisation_created_at_idx
  on redaction_runs (organisation_id, created_at desc)
  where deleted_at is null;

-- matters and matter_documents: deleted_at exists (0002); record the actor.
alter table matters
  add column if not exists deleted_by text references users(id);

alter table matter_documents
  add column if not exists deleted_by text references users(id);
