-- 0012_redaction_detection_provenance_and_retry.sql
--
-- Correct the conservative 0011 legacy backfill now that the UI distinguishes
-- unknown provenance from confirmed degradation. Also link a successful model
-- re-detection run to the source run it replaces.

begin;

alter table redaction_runs
  add column if not exists replaces_run_id text;

alter table redaction_runs
  drop constraint if exists redaction_runs_detection_mode_check,
  drop constraint if exists redaction_runs_replaces_self_check,
  drop constraint if exists redaction_runs_replaces_fk,
  drop constraint if exists redaction_runs_id_organisation_unique;

update redaction_runs
set detection_mode = case
  when detector_version like '%;mode=model+supplement%' then 'model+supplement'
  when detector_version like '%;mode=heuristics+supplement%' then 'heuristics+supplement'
  when detector_version like '%;mode=supplement-only%' then 'heuristics+supplement'
  else 'unknown'
end
where detection_mode is distinct from case
  when detector_version like '%;mode=model+supplement%' then 'model+supplement'
  when detector_version like '%;mode=heuristics+supplement%' then 'heuristics+supplement'
  when detector_version like '%;mode=supplement-only%' then 'heuristics+supplement'
  else 'unknown'
end;

alter table redaction_runs
  alter column detection_mode set default 'unknown',
  alter column detection_mode set not null;

alter table redaction_runs
  add constraint redaction_runs_detection_mode_check check (
    detection_mode in ('model+supplement', 'heuristics+supplement', 'unknown')
  ),
  add constraint redaction_runs_replaces_self_check check (
    replaces_run_id is null or replaces_run_id <> id
  ),
  add constraint redaction_runs_id_organisation_unique unique (id, organisation_id),
  add constraint redaction_runs_replaces_fk foreign key (replaces_run_id, organisation_id)
    references redaction_runs(id, organisation_id);

create unique index if not exists redaction_runs_live_replacement_idx
  on redaction_runs (organisation_id, replaces_run_id)
  where replaces_run_id is not null and deleted_at is null;

commit;
