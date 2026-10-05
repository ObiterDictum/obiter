-- Stage 1 legislation fix-up: durable extraction-completeness flag.
--
-- NumberOfProvisions on the CLML Legislation tag counts every P1 open,
-- including BlockAmendment inserts that carry no document IdURI and
-- correctly never become rows, so an exact count match is unachievable by
-- construction. Ingest therefore stores every parsed document and records
-- the divergence here plus the per-year summary: a systematic gap (a dead
-- extract, a tokenizer drift) shows as a pattern instead of one silent
-- document. Empty string means the P1 extraction matched the declaration.

alter table if exists legislation_documents
  add column if not exists provision_count_note text not null default '';
