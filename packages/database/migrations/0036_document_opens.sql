-- Where a person left off. One row per (document, user): a later open moves the
-- timestamp instead of appending history, because the dashboard only asks which
-- document this person last opened. The row is not an access grant — every
-- write and read behind it re-checks matter access — and it cascades away with
-- the document, so a deleted document never resurfaces as "continue".
create table if not exists document_opens (
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  user_id text not null references users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  constraint document_opens_pk primary key (document_id, user_id),
  -- The composite FK pins the row to a real document of a real matter in the
  -- same organisation: a fabricated id cannot be recorded, and deleting the
  -- document takes the timestamp with it.
  constraint document_opens_document_fk foreign key (
    document_id,
    matter_id,
    organisation_id
  ) references matter_documents (id, matter_id, organisation_id)
    on delete cascade
);

-- The dashboard reads one row per person, newest first.
create index if not exists document_opens_user_recency_idx
  on document_opens (user_id, opened_at desc);
