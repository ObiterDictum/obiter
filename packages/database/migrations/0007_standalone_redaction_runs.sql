alter table redaction_runs
  drop constraint if exists redaction_runs_matter_fk,
  drop constraint if exists redaction_runs_document_fk,
  drop constraint if exists redaction_runs_document_version_fk,
  alter column matter_id drop not null,
  alter column document_id drop not null,
  alter column document_version_id drop not null,
  add column if not exists source_filename text,
  add column if not exists source_text_object_key text;

update redaction_runs run
set source_filename = version.filename
from document_versions version
where version.id = run.document_version_id
  and run.source_filename is null;

alter table redaction_runs
  alter column source_filename set not null,
  add constraint redaction_runs_optional_matter_chain_check check (
    (matter_id is null and document_id is null and document_version_id is null)
    or (matter_id is not null and document_id is not null and document_version_id is not null)
  ),
  add constraint redaction_runs_source_filename_check check (
    length(btrim(source_filename)) > 0
  ),
  add constraint redaction_runs_source_text_object_key_check check (
    (matter_id is not null and source_text_object_key is null)
    or (matter_id is null and source_text_object_key = 'org/' || organisation_id || '/redaction-runs/' || id || '/source')
  ),
  add constraint redaction_runs_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  add constraint redaction_runs_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  add constraint redaction_runs_document_version_fk foreign key (document_version_id, document_id, matter_id, organisation_id)
    references document_versions(id, matter_document_id, matter_id, organisation_id);

alter table artifacts
  drop constraint if exists artifacts_matter_fk,
  drop constraint if exists artifacts_document_fk,
  drop constraint if exists artifacts_document_version_fk,
  drop constraint if exists artifacts_object_key_check,
  alter column matter_id drop not null;

alter table artifacts
  add constraint artifacts_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  add constraint artifacts_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  add constraint artifacts_document_version_fk foreign key (document_version_id, document_id, matter_id, organisation_id)
    references document_versions(id, matter_document_id, matter_id, organisation_id),
  add constraint artifacts_optional_matter_chain_check check (
    (matter_id is null and document_id is null and document_version_id is null)
    or (matter_id is not null)
  ),
  add constraint artifacts_object_key_check check (
    object_key is null
    or (matter_id is not null and object_key = 'org/' || organisation_id || '/matters/' || matter_id || '/artifacts/' || id)
    or (matter_id is null and object_key = 'org/' || organisation_id || '/artifacts/' || id)
  );

create index if not exists redaction_runs_organisation_created_at_idx
  on redaction_runs (organisation_id, created_at desc);
