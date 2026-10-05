-- P0.20: a matter share's grantee must belong to the share's organisation.
--
-- 0013 scopes the matter side of matter_shares with a composite foreign key
-- but ties grantee_user_id to users(id) alone, so a direct write could name a
-- grantee outside the share organisation. grantMatterShare
-- (routes/document-access.ts) already rejects that, but a contract enforced on
-- one path and not its sibling is defect pattern P3, and it is what let the
-- PR #137 experiment return another organisation's matter. This makes the
-- schema reject it as well.
--
-- created_by is deliberately left as users(id): it records who granted the
-- share (historical authorship), not current membership, so the recipient's
-- rule does not apply to it.

-- Refuse to enforce the invariant over rows that already violate it. The
-- operator reviews and revokes through the matter-share API, then re-runs;
-- nothing is silently deleted or rewritten to make validation pass.
do $$
declare
  offending integer;
  sample text;
begin
  select count(*)
    into offending
  from matter_shares s
  where not exists (
    select 1
    from users u
    where u.id = s.grantee_user_id
      and u."organisationId" = s.organisation_id
  );
  if offending > 0 then
    select string_agg(
        format(
          '%s (matter %s, grantee %s, organisation %s)',
          id, matter_id, grantee_user_id, organisation_id
        ),
        '; ' order by id
      )
      into sample
    from (
      select id, matter_id, grantee_user_id, organisation_id
      from matter_shares s
      where not exists (
        select 1
        from users u
        where u.id = s.grantee_user_id
          and u."organisationId" = s.organisation_id
      )
      order by id
      limit 20
    ) bad;
    raise exception
      'P0.20 cannot enforce matter-share organisation membership: % matter_shares row(s) name a grantee outside the share organisation. Revoke them through DELETE /api/matters/:matterId/shares/:shareId (which audits the revocation) or, after review, delete the rows, then re-run this migration. Offending (up to 20): %',
      offending, sample
      using errcode = 'foreign_key_violation';
  end if;
end $$;

-- Referenced key for the composite foreign key. id is already the primary key,
-- so this only gives PostgreSQL the non-partial unique index it requires to
-- point a multi-column foreign key at target columns.
create unique index if not exists users_id_organisation_key
  on users (id, "organisationId");

-- Replace the single-column grantee key with the organisation-scoped one.
-- Cascade is preserved so deleting a user still removes their shares.
alter table matter_shares
  drop constraint if exists matter_shares_grantee_fk;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'matter_shares'::regclass
      and conname = 'matter_shares_grantee_organisation_fk'
  ) then
    alter table matter_shares
      add constraint matter_shares_grantee_organisation_fk
      foreign key (grantee_user_id, organisation_id)
      references users (id, "organisationId")
      on delete cascade;
  end if;
end $$;
