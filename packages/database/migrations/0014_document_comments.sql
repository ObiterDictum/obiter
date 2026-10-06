create table if not exists document_comments (
  id text primary key default ('cmt_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  anchor_version_id text,
  paragraph_id text not null,
  start_offset integer not null,
  end_offset integer not null,
  body text not null,
  author_id text not null,
  author_name text not null,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_comments_id_prefix_check check (id like 'cmt_%'),
  constraint document_comments_paragraph_id_check check (
    length(btrim(paragraph_id)) > 0 and length(paragraph_id) <= 255
  ),
  constraint document_comments_start_offset_check check (start_offset >= 0),
  constraint document_comments_end_offset_check check (end_offset >= start_offset),
  constraint document_comments_body_check check (
    length(btrim(body)) > 0 and length(body) <= 10000
  ),
  constraint document_comments_author_name_check check (
    length(btrim(author_name)) > 0 and length(author_name) <= 200
  ),
  constraint document_comments_resolution_pair_check check (
    (resolved_at is null and resolved_by is null)
    or (resolved_at is not null and resolved_by is not null)
  ),
  constraint document_comments_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint document_comments_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id) on delete cascade,
  constraint document_comments_anchor_version_fk foreign key (
    anchor_version_id, document_id, matter_id, organisation_id
  ) references document_versions(id, matter_document_id, matter_id, organisation_id)
    on delete set null (anchor_version_id),
  constraint document_comments_author_fk foreign key (author_id)
    references users(id),
  constraint document_comments_resolved_by_fk foreign key (resolved_by)
    references users(id)
);

create index if not exists document_comments_organisation_document_created_idx
  on document_comments (organisation_id, document_id, created_at, id);

create index if not exists document_comments_organisation_matter_idx
  on document_comments (organisation_id, matter_id);
