-- A dismissal is a recorded human decision about one stored finding, not a
-- change to the check. The finding keeps its own state and stays in the run, so
-- the evidence record is never rewritten; the dismissal row adds who decided,
-- when, and why. It is keyed by (run_id, finding_id) because a finding id is
-- reproducible across runs of the same version, and a dismissal answers one
-- run's finding, not every future run of the same citation.
--
-- ON DELETE CASCADE is deliberate: a replaced or interrupted run deletes its
-- findings, and a dismissal of a finding that no longer exists would be an
-- orphaned claim about evidence nobody can inspect.

create table if not exists verification_finding_dismissals (
  run_id text not null,
  finding_id text not null,
  organisation_id text not null,
  reason text,
  dismissed_by text not null references users(id),
  dismissed_at timestamptz not null default now(),
  primary key (run_id, finding_id),
  constraint verification_finding_dismissals_reason_check check (
    reason is null or (char_length(btrim(reason)) > 0 and char_length(reason) <= 2000)
  ),
  constraint verification_finding_dismissals_finding_fk
    foreign key (run_id, finding_id)
    references verification_findings (run_id, finding_id)
    on delete cascade,
  -- Tenant isolation travels with the finding: a dismissal cannot be attached
  -- to another organisation's run.
  constraint verification_finding_dismissals_run_org_fk
    foreign key (run_id, organisation_id)
    references verification_runs (id, organisation_id)
    on delete cascade
);

create index if not exists verification_finding_dismissals_org_idx
  on verification_finding_dismissals (organisation_id, run_id);
