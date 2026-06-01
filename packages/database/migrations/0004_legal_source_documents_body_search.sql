drop index if exists legal_source_documents_search_vector_idx;

alter table legal_source_documents
  drop column if exists search_vector;

alter table legal_source_documents
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(summary_json->>'id', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_json->>'neutralCitation', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_json->>'title', '')), 'B') ||
    setweight(
      to_tsvector(
        'english',
        coalesce(jsonb_path_query_array(document_json, '$.paragraphs[*].text')::text, '')
      ),
      'C'
    )
  ) stored;

create index if not exists legal_source_documents_search_vector_idx
  on legal_source_documents using gin (search_vector);
