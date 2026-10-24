-- "Artefact" now means a source a person attaches to a matter
-- (docs/specs/matter-artefacts.md). Generated files are "outputs".
-- Rows written before this migration keep their `art_` ids and
-- `/artifacts/` object keys, so no stored object has to move.

alter table artifacts rename to outputs;
alter table outputs rename column artifact_type to output_type;
alter table outputs alter column id set default ('out_' || gen_random_uuid()::text);

alter table outputs rename constraint artifacts_matter_fk to outputs_matter_fk;
alter table outputs rename constraint artifacts_document_fk to outputs_document_fk;
alter table outputs rename constraint artifacts_document_version_fk to outputs_document_version_fk;
alter table outputs rename constraint artifacts_document_version_requires_document_check
  to outputs_document_version_requires_document_check;
alter table outputs rename constraint artifacts_optional_matter_chain_check
  to outputs_optional_matter_chain_check;
alter table outputs rename constraint artifacts_status_check to outputs_status_check;
alter table outputs rename constraint artifacts_failure_reason_check to outputs_failure_reason_check;
alter table outputs rename constraint artifacts_pkey to outputs_pkey;
alter table outputs rename constraint artifacts_created_by_fkey to outputs_created_by_fkey;

alter table outputs
  drop constraint artifacts_id_prefix_check,
  drop constraint artifacts_type_check,
  drop constraint artifacts_object_key_check;

alter table outputs
  add constraint outputs_id_prefix_check check (id like 'out_%' or id like 'art_%'),
  add constraint outputs_type_check check (
    output_type in (
      'document_text',
      'upload_receipt',
      'processing_log',
      'redaction_report',
      'redaction_output',
      'verification_report',
      'research_memo'
    )
  ),
  add constraint outputs_object_key_check check (
    object_key is null
    or object_key = 'org/' || organisation_id
      || case when matter_id is null then '' else '/matters/' || matter_id end
      || case when id like 'art_%' then '/artifacts/' else '/outputs/' end
      || id
  );

alter index artifacts_matter_idx rename to outputs_matter_idx;
alter index artifacts_document_idx rename to outputs_document_idx;
alter index artifacts_document_version_idx rename to outputs_document_version_idx;
alter index artifacts_status_idx rename to outputs_status_idx;
alter index artifacts_organisation_matter_idx rename to outputs_organisation_matter_idx;
alter index artifacts_created_by_idx rename to outputs_created_by_idx;

alter table redaction_runs rename column output_artifact_id to output_id;
alter table redaction_runs
  rename constraint redaction_runs_output_artifact_id_fkey to redaction_runs_output_id_fkey;
