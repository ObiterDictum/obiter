-- E50: authoritative cross-version edit lineage.
--
-- The lineage records how content in the base version was transformed into the
-- resulting version by an accepted edit batch. It is produced while operations
-- are applied and is stored atomically with the immutable version it describes,
-- so an idempotent replay returns the same mapping rather than recomputing one.
-- Null for versions created before this column existed and for uploads.
alter table document_versions
  add column if not exists lineage jsonb;

alter table document_versions
  add constraint document_versions_lineage_object_check
  check (lineage is null or jsonb_typeof(lineage) = 'object');
