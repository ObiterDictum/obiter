-- Sources kept with a matter.
--
-- The home page promises a matter keeps the sources you find; until now a
-- judgment or provision could only be opened, not kept. A saved row records
-- that one member filed one source against one matter. It is not a copy of
-- the source: `source_id` is the corpus identity (a judgment document id, or
-- `{documentIdentity}/{labelPath}` for a provision), so the saved entry always
-- reads the same stored text the source page does.
--
-- `organisation_id` is denormalised alongside `matter_id` for the same reason
-- matter_shares carries it: the access check can then filter by organisation
-- without joining matters, and a row cannot be read across organisations even
-- if the join is forgotten. The composite foreign key pins the pair to one
-- matter, so the denormalised column cannot drift.
--
-- Soft delete: unsaving sets `deleted_at` rather than removing the row, so a
-- re-save is idempotent against the unique key and the audit trail keeps the
-- fact that it was filed once.

create table if not exists matter_saved_sources (
  id text primary key default ('svs_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  source_kind text not null,
  source_id text not null,
  title text not null,
  citation text,
  source_url text,
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint matter_saved_sources_id_prefix_check check (id like 'svs_%'),
  constraint matter_saved_sources_source_kind_check check (
    source_kind in ('judgment', 'legislation')
  ),
  constraint matter_saved_sources_source_id_check check (
    length(btrim(source_id)) > 0
  ),
  constraint matter_saved_sources_title_check check (
    length(btrim(title)) > 0
  ),
  constraint matter_saved_sources_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint matter_saved_sources_created_by_fk foreign key (created_by)
    references users(id),
  constraint matter_saved_sources_deleted_by_fk foreign key (deleted_by)
    references users(id),
  constraint matter_saved_sources_matter_source_key unique (
    matter_id, source_kind, source_id
  )
);

create index if not exists matter_saved_sources_organisation_matter_idx
  on matter_saved_sources (organisation_id, matter_id)
  where deleted_at is null;
