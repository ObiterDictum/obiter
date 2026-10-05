-- Store original upload bytes and PDF text-layout geometry for redaction review.
alter table redaction_runs
  add column if not exists source_file_object_key text,
  add column if not exists source_layout_object_key text,
  add column if not exists source_mime_type text;

alter table redaction_runs
  drop constraint if exists redaction_runs_source_file_object_key_check,
  drop constraint if exists redaction_runs_source_layout_object_key_check;

alter table redaction_runs
  add constraint redaction_runs_source_file_object_key_check check (
    source_file_object_key is null
    or (
      matter_id is null
      and source_file_object_key = 'org/' || organisation_id || '/redaction-runs/' || id || '/original'
    )
  ),
  add constraint redaction_runs_source_layout_object_key_check check (
    source_layout_object_key is null
    or (
      matter_id is null
      and source_layout_object_key = 'org/' || organisation_id || '/redaction-runs/' || id || '/layout.json'
    )
  );
