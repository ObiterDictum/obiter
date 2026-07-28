-- 0011_redaction_detection_mode.sql
--
-- Make the detector mode a structured field on every redaction run. Historical
-- rows with explicit model provenance retain it. Rows without that provenance
-- are treated conservatively as degraded so legacy uncertainty is visible.

begin;

alter table redaction_runs
  add column if not exists detection_mode text;

update redaction_runs
set detection_mode = case
  when detector_version like '%;mode=model+supplement%' then 'model+supplement'
  else 'heuristics+supplement'
end
where detection_mode is null;

alter table redaction_runs
  alter column detection_mode set default 'heuristics+supplement',
  alter column detection_mode set not null;

alter table redaction_runs
  drop constraint if exists redaction_runs_detection_mode_check;

alter table redaction_runs
  add constraint redaction_runs_detection_mode_check check (
    detection_mode in ('model+supplement', 'heuristics+supplement')
  );

commit;
