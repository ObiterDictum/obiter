-- Judges and the court's published summary on the case-law store.
--
-- Licence boundary: Obiter holds the Open Justice Licence, which lets it store
-- and republish a judgment, but not The National Archives'
-- computational-analysis licence. Until that is granted these two fields may
-- only be read from what Find Case Law publishes as structured metadata, never
-- derived from judgment prose:
--
--   * `judges` comes from the `<judge>` elements The National Archives marks up
--     in the LegalDocML `<header>` (`legaldocml:judge`). A judgment whose cover
--     page names the bench only in prose has no such element, so its row keeps
--     `judges` NULL and the page shows no panel rather than a guess.
--   * `summary` is the court's own press summary, published by Find Case Law as
--     a separate LegalDocML document that links back through `<uk:summaryOf>`
--     (`legaldocml:press-summary`). It is quoted, not generated.
--
-- Every stored value carries `source` (`fcl_metadata` now, `extracted` for a
-- licensed extractor later) and the `field` it was read from, so a later pass
-- can fill the same columns with different provenance and a reader can tell
-- which rows came from which.
--
-- `metadata_fetched_at` is the queue and the record at once: NULL means "not
-- yet re-fetched for these fields", so the backfill is resumable and
-- idempotent, and a row that was fetched and carried neither field is stamped
-- too — its absence was read, not assumed.

alter table legal_source_documents
  add column if not exists judges jsonb,
  add column if not exists summary jsonb,
  add column if not exists metadata_fetched_at timestamptz;

alter table legal_source_documents
  add constraint legal_source_documents_judges_array_check check (
    judges is null or jsonb_typeof(judges) = 'array'
  ),
  add constraint legal_source_documents_published_summary_object_check check (
    summary is null or jsonb_typeof(summary) = 'object'
  );

create index if not exists legal_source_documents_metadata_pending_idx
  on legal_source_documents (document_id)
  where metadata_fetched_at is null;
