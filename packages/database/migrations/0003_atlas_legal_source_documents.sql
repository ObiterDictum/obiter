create table if not exists legal_source_documents (
  document_id text primary key,
  summary_json jsonb not null,
  document_json jsonb,
  provider_json jsonb not null,
  content_hash text not null,
  source_uri text not null,
  xml_uri text,
  pdf_uri text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(summary_json->>'id', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_json->>'neutralCitation', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_json->>'title', '')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_source_documents_document_id_not_blank_check check (length(btrim(document_id)) > 0),
  constraint legal_source_documents_summary_object_check check (jsonb_typeof(summary_json) = 'object'),
  constraint legal_source_documents_document_object_check check (
    document_json is null or jsonb_typeof(document_json) = 'object'
  ),
  constraint legal_source_documents_provider_object_check check (jsonb_typeof(provider_json) = 'object'),
  constraint legal_source_documents_content_hash_not_blank_check check (length(btrim(content_hash)) > 0),
  constraint legal_source_documents_source_uri_not_blank_check check (length(btrim(source_uri)) > 0),
  constraint legal_source_documents_xml_uri_not_blank_check check (
    xml_uri is null or length(btrim(xml_uri)) > 0
  ),
  constraint legal_source_documents_pdf_uri_not_blank_check check (
    pdf_uri is null or length(btrim(pdf_uri)) > 0
  )
);

create index if not exists legal_source_documents_source_uri_idx
  on legal_source_documents (source_uri);

create index if not exists legal_source_documents_content_hash_idx
  on legal_source_documents (content_hash);

create index if not exists legal_source_documents_summary_metadata_idx
  on legal_source_documents (
    (summary_json->>'court'),
    (summary_json->>'jurisdiction'),
    (summary_json->>'sourceType'),
    (summary_json->>'dateDecided')
  );

create index if not exists legal_source_documents_summary_gin_idx
  on legal_source_documents using gin (summary_json);

create index if not exists legal_source_documents_search_vector_idx
  on legal_source_documents using gin (search_vector);
