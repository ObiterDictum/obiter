import {
  Button,
  Input,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@obiter/ui'
import { Plus } from '@obiter/ui/icons'
import { useState, type FormEvent } from 'react'
import {
  userRoleSchema,
  type UserRole,
  type OrganisationMember,
} from '@obiter/contracts'
import { ApiError } from '../api'
import {
  useCreateOrganisationInvite,
  useOrganisationInvites,
  useOrganisationMembers,
  useRevokeOrganisationInvite,
} from '../organisation-membership'
import { formatDate, initialsOf } from '../format'
import { ErrorNotice } from './settings-fields'
import { RemoveMemberDialog } from './remove-member-dialog'

export function OrganisationPeople({
  organisationId,
  role,
  selfId,
  active,
}: {
  organisationId: string
  role: 'owner' | 'admin'
  selfId: string
  active: boolean
}) {
  const canRemove = role === 'owner'
  const members = useOrganisationMembers(organisationId, { enabled: active })
  const invites = useOrganisationInvites(organisationId, { enabled: active })
  const invite = useCreateOrganisationInvite(organisationId)
  const revoke = useRevokeOrganisationInvite(organisationId)
  const [removing, setRemoving] = useState<OrganisationMember | null>(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('member')
  const [legalRoleAttested, setLegalRoleAttested] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError(null)
    try {
      await invite.mutateAsync({
        email: email.trim(),
        role: inviteRole,
        legalRoleAttested: true,
      })
      setEmail('')
      setLegalRoleAttested(false)
    } catch (cause) {
      setActionError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not send the invite.',
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
      {removing ? (
        <RemoveMemberDialog
          organisationId={organisationId}
          member={removing}
          selfId={selfId}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      {actionError ? <ErrorNotice message={actionError} /> : null}

      {members.data && members.data.length > 0 ? (
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
                          onClick={() => setRemoving(member)}
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
        <Select
          label="Role"
          options={[
            { value: 'member', label: 'Member' },
            { value: 'admin', label: 'Admin' },
            ...(role === 'owner' ? [{ value: 'owner', label: 'Owner' }] : []),
          ]}
          value={inviteRole}
          onValueChange={(next) => {
            const parsed = userRoleSchema.safeParse(next)
            if (parsed.success) setInviteRole(parsed.data)
          }}
        />
        <p className="text-caption text-muted">
          Use their address on your organisation's verified email domain. Anyone
          else can request access themselves.
        </p>
        <label className="flex items-start gap-3 text-meta text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-brand"
            checked={legalRoleAttested}
            onChange={(event) => {
              setLegalRoleAttested(event.target.checked)
              setActionError(null)
            }}
          />
          <span>
            I confirm this person works in a legal role here: a legal
            professional, trainee, pupil, paralegal or other legal staff.
          </span>
        </label>
        <div>
          <Button
            type="submit"
            loading={invite.isPending}
            disabled={
              email.trim().length === 0 ||
              !legalRoleAttested ||
              invite.isPending
            }
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
