-- 0009_nullable_audit_organisation.sql
--
-- With self-registration no longer auto-provisioning an organisation (see
-- auth.ts), a freshly registered user is org-less. Their sign-up and sign-in
-- must still be auditable, so auth audit rows are written with
-- organisation_id = null until the user creates an organisation.
--
-- audit_logs.organisation_id was created NOT NULL in 0001; drop that
-- constraint here so appendAuditLog can persist a null organisation_id for
-- org-less auth events. Org-scoped actions always pass a real organisation id.

alter table audit_logs
  alter column organisation_id drop not null;
