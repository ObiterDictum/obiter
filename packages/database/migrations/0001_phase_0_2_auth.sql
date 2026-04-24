create extension if not exists pgcrypto;

create table if not exists organisations (
  id text primary key default ('org_' || gen_random_uuid()::text),
  name text not null,
  plan text not null default 'private_beta',
  data_region text not null default 'eu',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_plan_check check (plan in ('private_beta')),
  constraint organisations_data_region_check check (data_region in ('eu'))
);

create table if not exists audit_logs (
  id text primary key default ('aud_' || gen_random_uuid()::text),
  organisation_id text not null references organisations(id),
  user_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  request_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_organisation_created_at_idx
  on audit_logs (organisation_id, created_at desc);

create index if not exists audit_logs_entity_idx
  on audit_logs (entity_type, entity_id);

create table if not exists beta_access_grants (
  id text primary key default ('beta_' || gen_random_uuid()::text),
  email text not null unique,
  organisation_id text not null references organisations(id),
  role text not null,
  invited_by text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_access_grants_role_check check (role in ('owner', 'admin', 'member'))
);

create index if not exists beta_access_grants_organisation_idx
  on beta_access_grants (organisation_id);

-- Better Auth owns users, sessions, accounts, and verifications. Its CLI should
-- generate those tables from services/api/src/auth.ts so session truth is not
-- duplicated in Ormont application tables.
