import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api'
import { useCreateOrganisation, useCurrentUser } from '../current-user'

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
                <dd className="font-medium capitalize text-ink">{me.user.role}</dd>
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
