-- 0008_organisationless_users.sql
--
-- Self-registration no longer auto-provisions an organisation (see auth.ts).
-- New users exist org-less (users."organisationId" and users.role are both
-- already nullable since 0001) and create one explicitly via
-- POST /api/organisations. The single-organisation-per-user invariant is
-- enforced in code (createOrganisationForUser checks + locks the row) and is
-- backed here by a partial unique index: at most one non-null
-- "organisationId" per user. This also closes the concurrent-create race,
-- since two transactions that both read a null organisationId are still
-- serialised by the unique constraint at commit.
--
-- users."organisationId" is a nullable text FK to organisations(id); it is
-- already nullable, so this migration only adds the partial unique index.

create unique index if not exists users_single_organisation_idx
  on users ("organisationId")
  where "organisationId" is not null;
