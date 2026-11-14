import {
  Button,
  Input,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@obiter/ui'
import { Plus } from '@obiter/ui/icons'
import { useState, type FormEvent } from 'react'
import { userRoleSchema, type UserRole } from '@obiter/contracts'
import { ApiError } from '../api'
import {
  useCreateOrganisationInvite,
  useOrganisationInvites,
  useRevokeOrganisationInvite,
} from '../organisation-membership'
import { formatDate } from '../format'
import { ErrorNotice, roleLabel } from './settings-fields'

export function InviteMemberForm({
  organisationId,
  role,
}: {
  organisationId: string
  role: UserRole
}) {
  const invite = useCreateOrganisationInvite(organisationId)
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

  return (
    <>
      {actionError ? <ErrorNotice message={actionError} /> : null}
      <form
        className="flex max-w-[480px] flex-col gap-3"
        onSubmit={handleInvite}
        noValidate
      >
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
    </>
  )
}

export function PendingInvites({
  organisationId,
  active,
}: {
  organisationId: string
  active: boolean
}) {
  const invites = useOrganisationInvites(organisationId, { enabled: active })
  const revoke = useRevokeOrganisationInvite(organisationId)
  const [actionError, setActionError] = useState<string | null>(null)

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
    <>
      {actionError ? <ErrorNotice message={actionError} /> : null}
      {invites.isPending ? (
        <Skeleton className="h-16" />
      ) : invites.isError ? (
        <ErrorNotice message="Could not load pending invites." />
      ) : invites.data && invites.data.length > 0 ? (
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
                  <TD>{roleLabel(pending.role)}</TD>
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
    </>
  )
}
