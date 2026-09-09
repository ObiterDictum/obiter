-- Stage 1 legislation search: UK Public General Acts as stored documents
-- with addressable provisions. Postgres is the system of record; the
-- Meilisearch legislation_provisions index is derived from these tables and
-- rebuilt from them, never written by the ingestor.
--
-- Identity comes from the legislation.gov.uk /id/ URI suffix (for example
-- ukpga/2020/1, provision section/13/2). The /id/ URI is the version-neutral
-- identifier published in every CLML data.xml IdURI attribute, so rows stay
-- stable across revised editions. Text columns use CHECK constraints, not
-- PostgreSQL enums, so a new extent or provision kind never needs a type
-- migration. Secondary legislation is explicitly out of Stage 1 scope; its
-- tables arrive in a later migration, not this one.

create table if not exists legislation_documents (
  identity text primary key,
  act_type text not null,
  year integer not null,
  number integer not null,
  title text not null,
  source_url text not null,
  content_hash text not null,
  extent text not null default '',
  updated_at timestamptz not null default now(),
  constraint legislation_documents_year_check check (year >= 1800),
  constraint legislation_documents_number_check check (number > 0),
  constraint legislation_documents_title_check check (char_length(title) > 0),
  constraint legislation_documents_identity_check check (
    identity = act_type || '/' || year::text || '/' || number::text
  )
);

create index if not exists legislation_documents_year_number_idx
  on legislation_documents (act_type, year, number);

create index if not exists legislation_documents_title_idx
  on legislation_documents (lower(title));

create table if not exists legislation_provisions (
  id text primary key,
  document_identity text not null references legislation_documents (identity),
  label_path text not null,
  label text not null,
  extent text not null default '',
  provision_text text not null,
  source_hash text not null,
  doc_order integer not null,
  has_unapplied_effects boolean not null default false,
  effects_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint legislation_provisions_label_path_check check (
    char_length(label_path) > 0
  ),
  constraint legislation_provisions_text_check check (
    char_length(provision_text) > 0
  ),
  constraint legislation_provisions_order_check check (doc_order >= 0)
);

create index if not exists legislation_provisions_document_idx
  on legislation_provisions (document_identity, doc_order);

create index if not exists legislation_provisions_label_idx
  on legislation_provisions (document_identity, label_path);

-- Per-Act ingest progress: one row per ukpga/year/number scope. Re-runs
-- resume after the last completed act; provision writes are idempotent on
-- source_hash, so a resumed run never duplicates rows.
create table if not exists legislation_ingest_progress (
  scope_key text primary key,
  act_type text not null,
  year integer not null,
  last_completed_number integer not null default 0,
  stored_count integer not null default 0,
  skipped_unchanged_count integer not null default 0,
  skipped_no_fulltext_count integer not null default 0,
  failed_count integer not null default 0,
  failures_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint legislation_ingest_progress_number_check check (
    last_completed_number >= 0
  )
);
