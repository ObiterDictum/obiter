alter table redaction_runs
  add column detection_input_key text,
  add column detection_input_type text check (detection_input_type in ('pdf', 'docx', 'txt')),
  add column detection_completed integer not null default 0 check (detection_completed >= 0),
  add column detection_total integer not null default 0 check (detection_total >= detection_completed),
  add column detection_attempts integer not null default 0 check (detection_attempts >= 0),
  add column detection_lease_token text,
  add column detection_lease_until timestamptz,
  add constraint redaction_detection_input_check check (
    (detection_input_key is null) = (detection_input_type is null)
  );

alter table redaction_runs drop constraint redaction_runs_source_layout_object_key_check;
alter table redaction_runs add constraint redaction_runs_source_layout_object_key_check check (
  source_layout_object_key is null
  or source_layout_object_key = 'org/' || organisation_id || '/redaction-runs/' || id || '/layout.json'
);

create index redaction_detection_claim_idx on redaction_runs (detection_lease_until, created_at)
  where status = 'detecting' and deleted_at is null;
