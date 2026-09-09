-- Stage 1 legislation fix-up: addressable container rows.
--
-- Whole-Act contents need Part and Schedule rows (plus Chapters and
-- crossheadings) so Parts containing sections and Schedules containing
-- paragraphs render as a hierarchy instead of one flat section list.
-- `kind` carries the CLML element tag for provisions (P1..P5) or the
-- container name (part, chapter, schedule, crossheading); `parent_label_path`
-- points at the nearest *addressable ancestor* in CLML nesting, never at a
-- label-path prefix, because inserted-amendment provisions carry
-- hierarchical IdURIs (part/2/section/100/kn1) while base provisions are
-- flat (section/100). Existing rows predating this migration carry the
-- transitional kind 'P1' until the forced re-ingest rewrites them; the
-- serving code must not be relied on before that re-ingest has run.

alter table if exists legislation_provisions
  add column if not exists kind text not null default 'P1',
  add column if not exists parent_label_path text,
  add constraint legislation_provisions_kind_check check (
    kind in ('part', 'chapter', 'schedule', 'crossheading', 'P1', 'P2', 'P3', 'P4', 'P5')
  );

-- Act-page tree reads are per document in document order; the existing
-- (document_identity, doc_order) index already serves the kind filter over
-- one document's rows, so no new index is needed.