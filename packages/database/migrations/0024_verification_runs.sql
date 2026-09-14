create table if not exists verification_runs (
  id text primary key,
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  document_version_id text not null,
  status text not null,
  failure_code text,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  deleted_at timestamptz,
  deleted_by text references users(id),
  constraint verification_runs_id_prefix_check check (id like 'vrun_%'),
  constraint verification_runs_status_check check (
    status in ('queued', 'running', 'completed', 'failed')
  ),
  constraint verification_runs_failure_code_check check (
    failure_code is null
    or failure_code in (
      'model_unavailable',
      'version_not_ready',
      'execution_failed'
    )
  ),
  constraint verification_runs_status_shape_check check (
    (
      status in ('queued', 'running')
      and completed_at is null
      and failure_code is null
    )
    or (
      status = 'completed'
      and completed_at is not null
      and failure_code is null
    )
    or (
      status = 'failed'
      and completed_at is not null
      and failure_code is not null
    )
  ),
  constraint verification_runs_id_org_unique unique (id, organisation_id),
  constraint verification_runs_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint verification_runs_document_fk
    foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  constraint verification_runs_document_version_fk
    foreign key (
      document_version_id, document_id, matter_id, organisation_id
    )
    references document_versions(
      id, matter_document_id, matter_id, organisation_id
    )
);

create unique index if not exists verification_runs_one_live_per_version_idx
  on verification_runs (organisation_id, document_id, document_version_id)
  where deleted_at is null;

create index if not exists verification_runs_organisation_created_idx
  on verification_runs (organisation_id, created_at desc);

create index if not exists verification_runs_document_idx
  on verification_runs (organisation_id, document_id, created_at desc);

create table if not exists verification_findings (
  run_id text not null,
  finding_id text not null,
  organisation_id text not null,
  finding_type text not null,
  status_state text not null,
  status_reason text,
  severity text,
  confidence text,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, finding_id),
  constraint verification_findings_finding_id_prefix_check
    check (finding_id like 'vf:%'),
  constraint verification_findings_type_check check (
    finding_type in (
      'authority_existence',
      'citation_resolution',
      'quote_fidelity'
    )
  ),
  constraint verification_findings_status_state_check check (
    status_state in ('clear', 'flagged', 'not_checked', 'review_required')
  ),
  constraint verification_findings_status_reason_check check (
    (
      status_state = 'review_required'
      and status_reason in (
        'citation_ambiguous',
        'citation_unresolved',
        'authority_not_held',
        'evidence_unavailable',
        'check_inconclusive'
      )
    )
    or (status_state <> 'review_required' and status_reason is null)
  ),
  constraint verification_findings_severity_check check (
    severity is null or severity in ('high', 'medium', 'low')
  ),
  constraint verification_findings_confidence_check check (
    confidence is null or confidence in ('high', 'medium', 'low')
  ),
  constraint verification_findings_payload_object_check check (
    jsonb_typeof(payload_json) = 'object'
  ),
  constraint verification_findings_run_org_fk
    foreign key (run_id, organisation_id)
    references verification_runs(id, organisation_id)
    on delete cascade
);

create index if not exists verification_findings_organisation_idx
  on verification_findings (organisation_id, run_id);
