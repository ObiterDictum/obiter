create table if not exists legal_ingestor_progress (
  scope_key text primary key,
  court text not null,
  date_from text,
  date_to text,
  last_completed_page integer not null default 0,
  stored_count integer not null default 0,
  skipped_unchanged_count integer not null default 0,
  skipped_no_fulltext_count integer not null default 0,
  failed_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint legal_ingestor_progress_last_completed_page_check check (last_completed_page >= 0)
);
