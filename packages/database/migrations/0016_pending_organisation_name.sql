-- S17 follow-up: persist the organisation name typed at sign-up on the user
-- row (better-auth `pendingOrganisationName` additional field) so the first
-- organisation provisioning can consume it on any device. Verification often
-- completes on a different browser than sign-up, where no localStorage stash
-- would exist. Cleared once the user is assigned an organisation.
alter table users add column if not exists "pendingOrganisationName" text;
