import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input, Table, THead, TBody, TR, TH, TD } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { userRoleSchema, type UserRole } from '@obiter/contracts'
import { ApiError } from '../api'
import { useCreateOrganisation, useCurrentUser } from '../current-user'
import {
  useCreateOrganisationInvite,
  useOrganisationInvites,
  useOrganisationMembers,
  useRemoveOrganisationMember,
  useRevokeOrganisationInvite,
} from '../organisation-membership'

/**
 * Profile / settings. Organisation creation lives here — not as a first-login gate.
 */
export function SettingsRouteView() {
  const { data: me } = useCurrentUser()

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Profile and organisation for your Obiter workspace.
        </p>
      </header>

      <div className="flex flex-col divide-y divide-line">
        <section className="px-6 py-5" aria-label="Profile">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Profile
          </p>
          <dl className="grid max-w-lg gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium text-ink">{me.user.name}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted">Email</dt>
              <dd className="font-medium text-ink">{me.user.email}</dd>
            </div>
            {me.user.role ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">Role</dt>
                <dd className="font-medium capitalize text-ink">
                  {me.user.role}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="px-6 py-5" aria-label="Organisation">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Organisation
          </p>
          {me.organisation ? (
            <dl className="grid max-w-lg gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted">Name</dt>
                <dd className="font-medium text-ink">{me.organisation.name}</dd>
              </div>
            </dl>
          ) : (
            <CreateOrganisationForm />
          )}
        </section>

        {me.organisation &&
        (me.user.role === 'owner' || me.user.role === 'admin') ? (
          <OrganisationPeople
            organisationId={me.organisation.id}
            role={me.user.role}
          />
        ) : null}
      </div>
    </div>
  )
}

function CreateOrganisationForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createOrganisation = useCreateOrganisation()
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = orgName.trim()
    if (!trimmed) {
      setError('Organisation name is required.')
      return
    }
    setError(null)
    try {
      await createOrganisation.mutateAsync({ name: trimmed })
      await navigate({ to: '/' })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict_detected') {
        setError('You already have an organisation. Refreshing…')
        try {
          await queryClient.refetchQueries({ queryKey: ['current-user'] })
        } catch {
          setError('Could not refresh your account. Reload the page.')
        }
      } else {
        setError('Could not create the organisation. Try again.')
      }
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted">
        Naming an organisation is optional. Matters and Redact work without
        creating one first — you get a personal workspace automatically. Add a
        name here when you want a shared organisation label.
      </p>
      <form className="flex flex-col gap-4" onSubmit={handleCreate} noValidate>
        <Input
          label="Organisation name"
          type="text"
          autoComplete="organization"
          required
          maxLength={120}
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          error={error ?? undefined}
        />
        <Button
          type="submit"
          loading={createOrganisation.isPending}
          iconEnd={<ArrowRight size={16} weight="bold" />}
          className="w-fit"
        >
          Create organisation
        </Button>
      </form>
    </div>
  )
}

function OrganisationPeople({
  organisationId,
  role,
}: {
  organisationId: string
  role: 'owner' | 'admin'
}) {
  const canRemove = role === 'owner'
  const members = useOrganisationMembers(organisationId)
  const invites = useOrganisationInvites(organisationId)
  const invite = useCreateOrganisationInvite(organisationId)
  const revoke = useRevokeOrganisationInvite(organisationId)
  const remove = useRemoveOrganisationMember(organisationId)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('member')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInviteError(null)
    try {
      await invite.mutateAsync({ email: email.trim(), role: inviteRole })
      setEmail('')
    } catch (cause) {
      setInviteError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not send the invite.',
      )
    }
  }

  async function handleRemove(userId: string) {
    setRemoveError(null)
    try {
      await remove.mutateAsync(userId)
    } catch (cause) {
      setRemoveError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not remove the member.',
      )
    }
  }

  return (
    <section className="px-6 py-5" aria-label="Members">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
        Members
      </p>
      {members.data && members.data.length > 0 ? (
        <Table className="mb-6 max-w-2xl">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              {canRemove ? <TH>Actions</TH> : null}
            </TR>
          </THead>
          <TBody>
            {members.data.map((member) => (
              <TR key={member.id}>
                <TD>{member.name}</TD>
                <TD>{member.email}</TD>
                <TD className="capitalize">{member.role}</TD>
                {canRemove ? (
                  <TD>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending}
                      onClick={() => void handleRemove(member.id)}
                    >
                      Remove
                    </Button>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="mb-6 text-sm text-muted">No members to show.</p>
      )}
      {removeError ? (
        <p className="mb-4 text-sm text-danger">{removeError}</p>
      ) : null}

      <form
        className="mb-8 flex max-w-lg flex-col gap-3"
        onSubmit={handleInvite}
        noValidate
      >
        <p className="text-sm font-medium text-ink">Invite a colleague</p>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={inviteError ?? undefined}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Role</span>
          <select
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
            value={inviteRole}
            onChange={(e) => {
              const parsed = userRoleSchema.safeParse(e.target.value)
              if (parsed.success) setInviteRole(parsed.data)
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <Button
          type="submit"
          loading={invite.isPending}
          iconEnd={<ArrowRight size={16} weight="bold" />}
          className="w-fit"
        >
          Send invite
        </Button>
      </form>

      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
        Pending invites
      </p>
      {invites.data && invites.data.length > 0 ? (
        <Table className="max-w-2xl">
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {invites.data.map((pending) => (
              <TR key={pending.id}>
                <TD>{pending.email}</TD>
                <TD className="capitalize">{pending.role}</TD>
                <TD>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={revoke.isPending}
                    onClick={() => {
                      void revoke.mutateAsync(pending.id).catch((cause) => {
                        setRemoveError(
                          cause instanceof ApiError
                            ? cause.message
                            : 'Could not revoke the invite.',
                        )
                      })
                    }}
                  >
                    Revoke
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted">No pending invites.</p>
      )}
    </section>
  )
}
