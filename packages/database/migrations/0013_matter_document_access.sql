create table if not exists matter_shares (
  id text primary key default ('shr_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  grantee_user_id text not null,
  access_level text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint matter_shares_id_prefix_check check (id like 'shr_%'),
  constraint matter_shares_access_level_check check (access_level in ('view', 'edit')),
  constraint matter_shares_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint matter_shares_grantee_fk foreign key (grantee_user_id)
    references users(id) on delete cascade,
  constraint matter_shares_created_by_fk foreign key (created_by)
    references users(id),
  constraint matter_shares_matter_grantee_key unique (matter_id, grantee_user_id)
);

create index if not exists matter_shares_organisation_matter_idx
  on matter_shares (organisation_id, matter_id);

create index if not exists matter_shares_organisation_grantee_idx
  on matter_shares (organisation_id, grantee_user_id);
