create table if not exists organisation_invites (
  id text primary key default ('inv_' || gen_random_uuid()::text),
  organisation_id text not null references organisations(id),
  email text not null,
  role text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint organisation_invites_id_prefix_check check (id like 'inv_%'),
  constraint organisation_invites_role_check check (role in ('owner', 'admin', 'member')),
  constraint organisation_invites_email_lower_check check (email = lower(email))
);

create unique index if not exists organisation_invites_open_email_idx
  on organisation_invites (organisation_id, email)
  where accepted_at is null and revoked_at is null;

create unique index if not exists organisation_invites_token_hash_idx
  on organisation_invites (token_hash);
