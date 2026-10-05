create table if not exists matters (
  id text primary key default ('mtr_' || gen_random_uuid()::text),
  organisation_id text not null references organisations(id),
  name text not null,
  description text,
  primary_jurisdiction text not null,
  secondary_jurisdictions jsonb not null default '[]'::jsonb,
  legal_domains jsonb not null default '[]'::jsonb,
  client_reference text not null default '',
  status text not null default 'active',
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint matters_id_prefix_check check (id like 'mtr_%'),
  constraint matters_name_not_blank_check check (length(btrim(name)) > 0),
  constraint matters_primary_jurisdiction_not_blank_check check (length(btrim(primary_jurisdiction)) > 0),
  constraint matters_secondary_jurisdictions_array_check check (jsonb_typeof(secondary_jurisdictions) = 'array'),
  constraint matters_legal_domains_array_check check (jsonb_typeof(legal_domains) = 'array'),
  constraint matters_status_check check (status in ('active', 'archived', 'deleted')),
  constraint matters_deleted_at_status_check check (
    (deleted_at is null and status <> 'deleted')
    or (deleted_at is not null and status = 'deleted')
  ),
  unique (id, organisation_id)
);

create index if not exists matters_organisation_idx
  on matters (organisation_id);

create index if not exists matters_organisation_status_idx
  on matters (organisation_id, status)
  where deleted_at is null;

create index if not exists matters_organisation_created_at_idx
  on matters (organisation_id, created_at desc)
  where deleted_at is null;

create index if not exists matters_created_by_idx
  on matters (created_by);

create table if not exists matter_documents (
  id text primary key default ('doc_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  current_version_id text,
  logical_key text not null default ('doc_' || gen_random_uuid()::text),
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint matter_documents_id_prefix_check check (id like 'doc_%'),
  constraint matter_documents_logical_key_not_blank_check check (length(btrim(logical_key)) > 0),
  constraint matter_documents_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  unique (id, organisation_id),
  unique (id, matter_id, organisation_id),
  unique (logical_key)
);

create index if not exists matter_documents_matter_idx
  on matter_documents (matter_id);

create index if not exists matter_documents_matter_deleted_at_idx
  on matter_documents (matter_id, deleted_at);

create index if not exists matter_documents_organisation_matter_idx
  on matter_documents (organisation_id, matter_id)
  where deleted_at is null;

create index if not exists matter_documents_created_by_idx
  on matter_documents (created_by);

create table if not exists document_versions (
  id text primary key default ('ver_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  matter_document_id text not null,
  filename text not null,
  file_type text not null,
  size_bytes bigint not null,
  object_key text not null,
  text_object_key text,
  document_status text not null default 'queued',
  failure_reason text,
  version_number integer not null,
  content_sha256 text not null,
  sync_state text not null default 'synced',
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_versions_id_prefix_check check (id like 'ver_%'),
  constraint document_versions_filename_not_blank_check check (length(btrim(filename)) > 0),
  constraint document_versions_file_type_not_blank_check check (length(btrim(file_type)) > 0),
  constraint document_versions_size_bytes_non_negative_check check (size_bytes >= 0),
  constraint document_versions_object_key_not_blank_check check (length(btrim(object_key)) > 0),
  constraint document_versions_text_object_key_not_blank_check check (
    text_object_key is null or length(btrim(text_object_key)) > 0
  ),
  constraint document_versions_document_status_check check (
    document_status in ('queued', 'processing', 'ready', 'failed', 'needs_review')
  ),
  constraint document_versions_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 2000
  ),
  constraint document_versions_version_number_positive_check check (version_number > 0),
  constraint document_versions_content_sha256_check check (content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  constraint document_versions_sync_state_check check (
    sync_state in ('local_only', 'queued', 'syncing', 'synced', 'conflict', 'failed')
  ),
  constraint document_versions_document_fk foreign key (matter_document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  constraint document_versions_object_key_shape_check check (
    object_key = 'org/' || organisation_id || '/matters/' || matter_id || '/documents/' || matter_document_id || '/versions/' || id || '/source'
  ),
  constraint document_versions_text_object_key_shape_check check (
    text_object_key is null
    or text_object_key = 'org/' || organisation_id || '/matters/' || matter_id || '/documents/' || matter_document_id || '/versions/' || id || '/text'
  ),
  unique (matter_document_id, version_number),
  unique (id, matter_document_id),
  unique (id, matter_document_id, matter_id, organisation_id)
);

create index if not exists document_versions_matter_document_version_idx
  on document_versions (matter_document_id, version_number desc);

create index if not exists document_versions_content_sha256_idx
  on document_versions (content_sha256);

create index if not exists document_versions_document_status_idx
  on document_versions (document_status);

create index if not exists document_versions_sync_state_idx
  on document_versions (sync_state);

create index if not exists document_versions_organisation_matter_idx
  on document_versions (organisation_id, matter_id);

create index if not exists document_versions_created_by_idx
  on document_versions (created_by);

create or replace function prevent_document_version_overwrite()
returns trigger
language plpgsql
as $$
begin
  if old.organisation_id is distinct from new.organisation_id
    or old.matter_id is distinct from new.matter_id
    or old.matter_document_id is distinct from new.matter_document_id
    or old.filename is distinct from new.filename
    or old.file_type is distinct from new.file_type
    or old.size_bytes is distinct from new.size_bytes
    or old.object_key is distinct from new.object_key
    or old.version_number is distinct from new.version_number
    or old.content_sha256 is distinct from new.content_sha256
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at then
    raise exception 'document_versions immutable fields cannot be updated';
  end if;

  return new;
end;
$$;

drop trigger if exists document_versions_prevent_overwrite on document_versions;

create trigger document_versions_prevent_overwrite
  before update on document_versions
  for each row
  execute function prevent_document_version_overwrite();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matter_documents_current_version_fk'
  ) then
    alter table matter_documents
      add constraint matter_documents_current_version_fk foreign key (current_version_id, id)
      references document_versions(id, matter_document_id);
  end if;
end $$;

create table if not exists artifacts (
  id text primary key default ('art_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  document_id text,
  document_version_id text,
  artifact_type text not null,
  status text not null default 'queued',
  object_key text,
  failure_reason text,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifacts_id_prefix_check check (id like 'art_%'),
  constraint artifacts_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint artifacts_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  constraint artifacts_document_version_requires_document_check check (
    document_version_id is null or document_id is not null
  ),
  constraint artifacts_document_version_fk foreign key (document_version_id, document_id, matter_id, organisation_id)
    references document_versions(id, matter_document_id, matter_id, organisation_id),
  constraint artifacts_type_check check (
    artifact_type in (
      'document_text',
      'upload_receipt',
      'processing_log',
      'redaction_report',
      'verification_report',
      'research_memo'
    )
  ),
  constraint artifacts_status_check check (status in ('queued', 'generating', 'ready', 'failed')),
  constraint artifacts_object_key_check check (
    object_key is null
    or object_key = 'org/' || organisation_id || '/matters/' || matter_id || '/artifacts/' || id
  ),
  constraint artifacts_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 2000
  )
);

create index if not exists artifacts_matter_idx
  on artifacts (matter_id);

create index if not exists artifacts_document_idx
  on artifacts (document_id);

create index if not exists artifacts_document_version_idx
  on artifacts (document_version_id);

create index if not exists artifacts_status_idx
  on artifacts (status);

create index if not exists artifacts_organisation_matter_idx
  on artifacts (organisation_id, matter_id);

create index if not exists artifacts_created_by_idx
  on artifacts (created_by);
