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
-- flat (section/100).
--
-- Rows predating this migration carry kind = NULL. That is the transitional
-- marker for an un-reparsed document, and it is deliberate that the column
-- starts nullable with no default instead of defaulting legacy rows to 'P1':
-- a default would mis-classify their P2..P5 content as top-level provisions
-- on the Act page until --force-reparse rewrites the rows. The serving code
-- checks the marker and returns unavailable for a document that still holds
-- unclassified rows; only the forced re-ingest (which rewrites every row of
-- a document in one transaction) clears the window. Keeping the column
-- nullable afterwards is intentional too: an unknown classification must
-- stay visibly unknown (fail-closed: excluded from listings, the search
-- index and the Act page) rather than silently defaulting to 'P1' when a
-- future writer forgets to set it.

alter table if exists legislation_provisions
  drop constraint if exists legislation_provisions_kind_check,
  add column if not exists kind text,
  add column if not exists parent_label_path text;

alter table if exists legislation_provisions
  alter column kind drop not null,
  alter column kind drop default,
  add constraint legislation_provisions_kind_check check (
    kind is null or kind in ('part', 'chapter', 'schedule', 'crossheading', 'P1', 'P2', 'P3', 'P4', 'P5')
  );

-- Act-page tree reads are per document in document order; the existing
-- (document_identity, doc_order) index already serves the kind filter over
-- one document's rows, so no new index is needed.