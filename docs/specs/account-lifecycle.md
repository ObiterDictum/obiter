# Account and organisation lifecycle

Settings additions for changing a sign-in email, changing member roles,
reading the member list, transferring ownership, leaving an organisation and
deleting an account. Contracts live in `packages/contracts/src/account.ts` and
`organisation.ts`; the API enforces every rule server-side.

## Decisions

- **Member list is readable by every member of that organisation.** The API
  returns members to any active member; invites and every mutation stay
  owner/admin-only. The Members settings section is visible to every
  organisation member; ordinary members see the list read-only and no invite,
  role or remove controls.
- **Role changes are owner-only and never grant `owner`.**
  `PATCH /api/organisations/:id/members/:userId` accepts only `admin` or
  `member`. The owner's own role cannot be changed here; ownership moves only
  through transfer. Role changes audit `organisation.member_role_update`.
- **Ownership transfer is atomic.** `POST .../transfer-ownership` with
  `{ userId }` promotes the target to `owner` and demotes the caller to
  `admin` in one transaction under the organisation advisory lock. The target
  must be another active member. Audits `organisation.ownership_transfer`.
  The UI requires typing the organisation name.
- **Leaving reuses member removal.** `POST .../leave` runs the same
  `removeMemberWithTransfers` path as member removal, including the 409
  `uncoveredMatters` contract, so every owned matter is reassigned before the
  membership is cleared. An owner leaving is refused with the typed
  `ownership_transfer_required` error; the UI shows "Transfer ownership before
  you leave." instead of a control the API refuses. Leaving audits
  `organisation.member_leave`.
- **Removal and leaving sign the member out everywhere.** Both paths delete
  every `sessions` row for the departing user inside the same transaction as
  the membership change, so the next request is refused and the person returns
  to sign-in. Removal audits `organisation.member_remove` and leaving audits
  `organisation.member_leave`; each record carries `revokedSessionCount` in its
  metadata alongside the existing share-revocation audits.
- **Sign-in email change keeps the old address until verified.** The flow uses
  the auth provider's change-email endpoint: the current password is
  re-verified server-side, a confirmation link goes to the NEW address, and the
  old email stays active until the link is used. The new domain must equal the
  current email domain or appear in `verified_organisation_domains` for the
  user's organisation (or globally); anything else is refused with a message
  telling the user to contact Obiter. The request audits `user.email_change`.
- **Account deletion is `DELETE /api/me` with the current password.** It
  refuses while the user owns an organisation that has other members
  (`ownership_transfer_required` semantics via `forbidden`). On success, in one
  transaction: the user row is marked `deletedAt`, organisation membership and
  role are cleared, every session row is deleted, and — when the user was the
  last member — the organisation is soft-deleted (`deleted_at`) and its live
  matters, documents and redaction runs are soft-deleted following the
  existing `deleted_at`/`deleted_by` convention, with per-matter
  `matter.delete` audit rows plus `organisation.delete` and
  `user.account_delete`. Pending invites are revoked. Sign-in is blocked for
  deleted users at session creation. Audit rows, document versions and matter
  history are untouched.
- **Identity anonymisation after six years.** Founder decision, 13 Nov 2026:
  a deleted user's name and email are kept for six years from
  `users."deletedAt"`, matching the UK six-year limitation period for civil
  claims, and are then replaced. Name becomes `Deleted user`; email becomes
  the unique non-routable `deleted-<userId>@deleted.invalid`; `image` and
  `pendingOrganisationName` are cleared; `anonymisedAt` marks the row done.
  The daily in-process `user-anonymisation` job selects due users, anonymises
  each in its own transaction and audits `user.anonymise`, and is safe to
  re-run. Audit rows, document versions and matter history keep the user id,
  so they show `Deleted user` afterwards, and the freed email can be used to
  sign up again.
- **Migrations `0053_account_lifecycle.sql` and
  `0054_user_anonymisation.sql`** add `users."deletedAt"`,
  `organisations.deleted_at` and `users."anonymisedAt"`. `0052` is reserved by
  another branch; `0053` and `0054` are the next free numbers on `origin/dev`.
