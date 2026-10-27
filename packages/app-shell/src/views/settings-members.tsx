import { Plus } from '@phosphor-icons/react'
import { Button, Input, Table, TBody, TD, TH, THead, TR } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { userRoleSchema, type UserRole } from '@obiter/contracts'
import { ApiError } from '../api'
import {
  useCreateOrganisationInvite,
  useOrganisationInvites,
  useOrganisationMembers,
  useRemoveOrganisationMember,
  useRevokeOrganisationInvite,
} from '../organisation-membership'
import { formatDate, initialsOf } from '../format'
import { ErrorNotice } from './settings-fields'

/**
 * Members and invites, for the roles that may manage them. Fetched when the
 * Organisation section is opened rather than on every Settings render.
 */

export function OrganisationPeople({
  organisationId,
  role,
  selfId,
  active,
}: {
  organisationId: string
  role: 'owner' | 'admin'
  /** The caller's own member id: you cannot remove yourself from here. */
  selfId: string
  active: boolean
}) {
  const canRemove = role === 'owner'
  // Member and invite lists are fetched when the section is opened, not on
  // every Settings render.
  const members = useOrganisationMembers(organisationId, { enabled: active })
  const invites = useOrganisationInvites(organisationId, { enabled: active })
  const invite = useCreateOrganisationInvite(organisationId)
  const revoke = useRevokeOrganisationInvite(organisationId)
  const remove = useRemoveOrganisationMember(organisationId)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('member')
  // One action error for the panel, cleared when any later action starts or
  // succeeds: a message about an operation the user has moved on from must not
  // stay on screen beside a later success (S16).
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError(null)
    try {
      await invite.mutateAsync({ email: email.trim(), role: inviteRole })
      setEmail('')
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not send the invite.',
      )
    }
  }

  async function handleRemove(userId: string) {
    setActionError(null)
    try {
      await remove.mutateAsync(userId)
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not remove the member.',
      )
    }
  }

  async function handleRevoke(inviteId: string) {
    setActionError(null)
    try {
      await revoke.mutateAsync(inviteId)
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not revoke the invite.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-6">
      <h3 className="text-section text-ink">Members</h3>
      {actionError ? <ErrorNotice message={actionError} /> : null}

      {members.data && members.data.length > 0 ? (
        // The table is wider than a narrow viewport; it scrolls inside its own
        // box rather than widening the page.
        <div className="overflow-x-auto">
          <Table className="min-w-[32rem]">
            <THead>
              <TR>
                <TH>Member</TH>
                <TH>Role</TH>
                {canRemove ? <TH align="end">Remove</TH> : null}
              </TR>
            </THead>
            <TBody>
              {members.data.map((member) => (
                <TR key={member.id}>
                  <TD>
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-7 shrink-0 place-items-center rounded-pill bg-fill text-caption text-muted"
                      >
                        {initialsOf(member.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-item text-ink">
                          {member.name}
                        </span>
                        <span className="block truncate text-caption text-subtle">
                          {member.email}
                        </span>
                      </span>
                    </span>
                  </TD>
                  <TD className="capitalize">{member.role}</TD>
                  {canRemove ? (
                    <TD className="text-end">
                      {member.id === selfId ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={remove.isPending}
                          onClick={() => void handleRemove(member.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <p className="text-meta text-muted">No members to show.</p>
      )}

      <form
        className="flex max-w-[420px] flex-col gap-3"
        onSubmit={handleInvite}
        noValidate
      >
        <p className="text-item text-ink">Invite a member</p>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setActionError(null)
          }}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-item text-ink">Role</span>
          <select
            className="h-control rounded-md border border-line bg-raised px-3 text-meta text-ink"
            value={inviteRole}
            onChange={(event) => {
              const parsed = userRoleSchema.safeParse(event.target.value)
              if (parsed.success) setInviteRole(parsed.data)
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            {role === 'owner' ? <option value="owner">Owner</option> : null}
          </select>
        </label>
        <div>
          <Button
            type="submit"
            loading={invite.isPending}
            disabled={email.trim().length === 0 || invite.isPending}
            iconStart={<Plus size={16} aria-hidden />}
          >
            Send invite
          </Button>
        </div>
      </form>

      <h3 className="text-section text-ink">Pending invites</h3>
      {invites.data && invites.data.length > 0 ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[32rem]">
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Sent</TH>
                <TH align="end"> </TH>
              </TR>
            </THead>
            <TBody>
              {invites.data.map((pending) => (
                <TR key={pending.id}>
                  <TD className="truncate">{pending.email}</TD>
                  <TD className="capitalize">{pending.role}</TD>
                  <TD className="text-muted">
                    {formatDate(pending.createdAt)}
                  </TD>
                  <TD className="text-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={revoke.isPending}
                      onClick={() => void handleRevoke(pending.id)}
                    >
                      Revoke
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <p className="text-meta text-muted">No pending invites.</p>
      )}
    </div>
  )
}
