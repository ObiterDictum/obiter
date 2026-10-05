-- Retire the Postgres full-text query tier. Meilisearch is the sole query
-- engine: nothing in the served flow reads search_vector since the
-- Postgres source-search path was removed, so the generated column is pure
-- write overhead — recomputed on every summary and document upsert — and
-- its GIN index is dead weight on every write. Postgres remains the system
-- of record: legal_source_documents still holds every judgment, the index
-- is rebuilt from it, and retrieval by id reads from it.
--
-- Dropping a generated column rewrites the table, so this runs in the same
-- per-file transaction as every other migration; on the 38k-row legal
-- corpus that rewrite is brief. Re-adding full-text search later would be a
-- new migration, not a revert of this one.

drop index if exists legal_source_documents_search_vector_idx;

alter table legal_source_documents
  drop column if exists search_vector;
