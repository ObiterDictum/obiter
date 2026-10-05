create table if not exists redaction_runs (
  id text primary key default ('red_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  document_version_id text not null,
  status text not null default 'pending',
  policy_mode text not null default 'internal_ai_minimisation',
  spans_json jsonb not null default '[]'::jsonb,
  decisions_json jsonb not null default '{}'::jsonb,
  output_artifact_id text references artifacts(id),
  summary_json jsonb not null default '{}'::jsonb,
  detector_version text,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redaction_runs_id_prefix_check check (id like 'red_%'),
  constraint redaction_runs_status_check check (
    status in ('pending', 'detecting', 'ready_for_review', 'reviewing', 'finalized', 'failed')
  ),
  constraint redaction_runs_policy_mode_check check (
    policy_mode in ('internal_ai_minimisation', 'external_sharing')
  ),
  constraint redaction_runs_spans_array_check check (jsonb_typeof(spans_json) = 'array'),
  constraint redaction_runs_decisions_object_check check (jsonb_typeof(decisions_json) = 'object'),
  constraint redaction_runs_summary_object_check check (jsonb_typeof(summary_json) = 'object'),
  constraint redaction_runs_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint redaction_runs_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  constraint redaction_runs_document_version_fk foreign key (document_version_id, document_id, matter_id, organisation_id)
    references document_versions(id, matter_document_id, matter_id, organisation_id)
);

create index if not exists redaction_runs_matter_idx
  on redaction_runs (matter_id);

create index if not exists redaction_runs_document_idx
  on redaction_runs (document_id);

create index if not exists redaction_runs_status_idx
  on redaction_runs (status);

create index if not exists redaction_runs_organisation_matter_idx
  on redaction_runs (organisation_id, matter_id);
