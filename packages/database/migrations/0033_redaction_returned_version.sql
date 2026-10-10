-- E12 redaction handoff: the document version a finalized redaction output
-- returned to. Provenance lives on the run, not just in audit logs, so the
-- review surface can show which version the redacted output became and a
-- retried return resolves to the same version instead of minting a second.
alter table redaction_runs
  add column if not exists returned_document_version_id text
    references document_versions(id);

-- A run returns at most once: its output is a complete replacement of the
-- source version's content, so a second return would either duplicate the
-- version or discard edits committed in between.
comment on column redaction_runs.returned_document_version_id is
  'Immutable document version created by returning this run''s finalized redacted output to its document.';
