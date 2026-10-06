-- Invite role clamp remediation: revoke open owner invites whose creator no
-- longer holds owner.
--
-- The clamp lands at invite creation, so an admin-created role = 'owner'
-- invite that was already open when this deploy runs still completes the
-- escalation on acceptance, up to its 7-day TTL. Revoking is safe because it
-- only touches invites whose creator cannot authorise an owner grant: an
-- owner-created owner invite is untouched, and a creator who has since lost
-- owner could not mint that invite under the clamp. Revoked rather than
-- deleted so the row and its audit trail remain, and the partial unique index
-- (open invites only) lets the address be re-invited. Idempotent: rows already
-- revoked are excluded, and non-owner invites are never touched.

update organisation_invites
set revoked_at = now()
where role = 'owner'
  and accepted_at is null
  and revoked_at is null
  and not exists (
    select 1
    from users
    where users.id = organisation_invites.created_by
      and users.role = 'owner'
  );
