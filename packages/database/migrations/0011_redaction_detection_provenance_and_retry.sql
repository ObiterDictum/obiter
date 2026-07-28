-- 0011_redaction_detection_provenance_and_retry.sql
--
-- Record structured detector provenance on every redaction run and link a
-- successful model re-detection run to the source run it replaces. Legacy
-- provenance is mapped conservatively, with unrecognised rows marked unknown.

begin;

alter table redaction_runs
  add column if not exists detection_mode text,
  add column if not exists replaces_run_id text;

alter table redaction_runs
  drop constraint if exists redaction_runs_detection_mode_check,
  drop constraint if exists redaction_runs_replaces_self_check,
  drop constraint if exists redaction_runs_replaces_fk,
  drop constraint if exists redaction_runs_id_organisation_unique;

-- detector_version is the source of truth for this migration-time legacy
-- normalisation. Runtime writes keep both fields aligned, so re-applying the
-- migration preserves valid application rows and corrects inconsistent values.
with mapped_detection_modes as (
  select
    id,
    case
      when detector_version like '%;mode=model+supplement%' then 'model+supplement'
      when detector_version like '%;mode=heuristics+supplement%' then 'heuristics+supplement'
      when detector_version like '%;mode=supplement-only%' then 'heuristics+supplement'
      else 'unknown'
    end as mode
  from redaction_runs
)
update redaction_runs as run
set detection_mode = mapping.mode
from mapped_detection_modes as mapping
where mapping.id = run.id
  and run.detection_mode is distinct from mapping.mode;

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
