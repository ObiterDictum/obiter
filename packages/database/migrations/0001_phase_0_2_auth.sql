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

create table if not exists users (
  id text primary key default ('usr_' || gen_random_uuid()::text),
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "organisationId" text references organisations(id),
  role text,
  constraint users_role_check check (role is null or role in ('owner', 'admin', 'member'))
);

create index if not exists users_organisation_id_idx
  on users ("organisationId");

create table if not exists sessions (
  id text primary key default ('ses_' || gen_random_uuid()::text),
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references users(id) on delete cascade
);

create index if not exists sessions_user_id_idx
  on sessions ("userId");

create table if not exists accounts (
  id text primary key default ('acc_' || gen_random_uuid()::text),
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references users(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists accounts_user_id_idx
  on accounts ("userId");

create unique index if not exists accounts_provider_account_idx
  on accounts ("providerId", "accountId");

create table if not exists verifications (
  id text primary key default ('ver_' || gen_random_uuid()::text),
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists verifications_identifier_idx
  on verifications (identifier);

create table if not exists audit_logs (
  id text primary key default ('aud_' || gen_random_uuid()::text),
  organisation_id text not null references organisations(id),
  user_id text references users(id),
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
