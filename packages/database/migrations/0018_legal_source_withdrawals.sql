-- Withdrawal tracking for legal_source_documents. Postgres stays the record:
-- a judgment withdrawn upstream is marked, never deleted (soft-delete
-- default), and the derived Meilisearch index drops it on rebuild.
--
-- The withdrawn/candidate state itself lives in provider_json
-- (`withdrawn`, `withdrawalCandidate` keys), matching the existing
-- provider_json-merge upserts in bulk ingestion: a later re-ingest preserves
-- the flags because the merge only overwrites keys the new row carries.
-- Camel case matches the provider metadata already stored there. Presence of
-- the `withdrawn` key is the predicate; every reader uses
-- `provider_json->>'withdrawn' is null` for "not withdrawn".
--
-- This table is the per-check audit trail: one row per URI fetched per run.
-- body_snippet_hash is a sha256 over a short prefix, never raw text, so the
-- audit proves what was seen without storing provider content.

create table if not exists legal_source_withdrawal_audits (
  id bigserial primary key,
  -- ON DELETE RESTRICT: audit rows are the evidence trail for a withdrawal
  -- decision, so a document with checks on record cannot be deleted out
  -- from under its own audit history. Withdrawn rows are marked, not
  -- removed, and this guard keeps the mark and its evidence together.
  document_id text not null references legal_source_documents (document_id) on delete restrict,
  checked_at timestamptz not null default now(),
  uri text not null,
  http_status integer,
  body_snippet_hash text,
  run_id text not null,
  outcome text not null,
  constraint legal_source_withdrawal_audits_uri_not_blank_check check (
    length(btrim(uri)) > 0
  ),
  constraint legal_source_withdrawal_audits_run_id_not_blank_check check (
    length(btrim(run_id)) > 0
  ),
  constraint legal_source_withdrawal_audits_outcome_check check (
    outcome in ('present', 'not_found', 'inconclusive')
  )
);

create index if not exists legal_source_withdrawal_audits_document_run_idx
  on legal_source_withdrawal_audits (document_id, run_id);
