-- Document presence is shared state between API instances: one row per
-- (document, user, client) heartbeat, so a cursor written through any
-- instance is visible to every other instance polling the same database, and
-- two tabs of one account stay distinct participants. Rows carry cursor
-- coordinates only — never document text — and expire by the database clock:
-- a closed tab's row stops matching reads after the heartbeat interval and a
-- bounded sweep reclaims it, so no session teardown or cleanup job is needed
-- for correctness.
create table if not exists document_presence (
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  version_id text not null,
  user_id text not null references users(id) on delete cascade,
  client_id text not null,
  paragraph_id text not null,
  run_id text not null,
  cursor_offset integer not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint document_presence_pk primary key (
    organisation_id,
    document_id,
    user_id,
    client_id
  ),
  -- The version FK pins every presence row to a real immutable version of
  -- the document it claims: a guessed or fabricated version id cannot be
  -- heartbeated, and presence for a superseded version stops matching
  -- current-version reads without a write. Rows cascade away with the
  -- version — ephemeral presence must never block document deletion.
  constraint document_presence_version_fk foreign key (
    version_id,
    document_id,
    matter_id,
    organisation_id
  ) references document_versions (
    id,
    matter_document_id,
    matter_id,
    organisation_id
  ) on delete cascade,
  constraint document_presence_client_id_check check (length(client_id) <= 64),
  constraint document_presence_paragraph_id_check check (
    length(paragraph_id) > 0
  ),
  constraint document_presence_run_id_check check (length(run_id) > 0),
  constraint document_presence_cursor_offset_check check (cursor_offset >= 0)
);

-- Document-scoped reads use the primary key prefix; this index is for the
-- bounded expiry sweep that reclaims abandoned rows on each write.
create index if not exists document_presence_expires_idx
  on document_presence (expires_at);
