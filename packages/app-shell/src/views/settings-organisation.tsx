import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ORGANISATION_NAME_MAX_LENGTH,
  type CurrentOrganisation,
  type MeResponse,
} from '@obiter/contracts'
import { ApiError } from '../api'
import { useCreateOrganisation, useRenameOrganisation } from '../current-user'
import {
  ErrorNotice,
  ReadOnlyField,
  SavedNotice,
  roleLabel,
} from './settings-fields'
import { OrganisationPeople } from './settings-members'

/**
 * Organisation settings: the tenant name, who may change it, and the members
 * and invites the product already supports. Rename stays owner-only, which is
 * the policy the API enforces (requireOwnerRole plus an ownership check against
 * the caller's own organisation), so an admin or member is shown the same facts
 * without an edit control that could only fail.
 */
export function OrganisationSection({
  me,
  active,
}: {
  me: MeResponse
  active: boolean
}) {
  const organisation = me.organisation

  return (
    <section
      hidden={!active}
      aria-labelledby="settings-organisation-heading"
      className="flex flex-col gap-6"
    >
      <div>
        <h2
          id="settings-organisation-heading"
          className="text-base font-semibold tracking-tight text-ink"
        >
          Organisation
        </h2>
        <p className="mt-1 text-sm text-muted">
          {organisation
            ? 'Changes here apply to everyone in your organisation.'
            : 'Name the organisation you work in. Matters and Redact work without one: you keep a personal workspace until you create one.'}
        </p>
      </div>

      {organisation ? (
        <>
          {me.user.role === 'owner' ? (
            <OrganisationNameForm organisation={organisation} />
          ) : (
            <div className="flex max-w-lg flex-col gap-3">
              <dl>
                <ReadOnlyField
                  label="Organisation name"
                  value={organisation.name}
                />
              </dl>
              <p className="text-sm text-muted">
                Only an owner can rename the organisation.
              </p>
            </div>
          )}

          <dl className="flex max-w-lg flex-col gap-4">
            <ReadOnlyField
              label="Your role"
              value={me.user.role ? roleLabel(me.user.role) : 'Member'}
            />
            <ReadOnlyField
              label="Organisation ID"
              value={organisation.id}
              mono
              helper="Quote this when contacting support."
            />
          </dl>

          {me.user.role === 'owner' || me.user.role === 'admin' ? (
            <OrganisationPeople
              organisationId={organisation.id}
              role={me.user.role}
              active={active}
            />
          ) : null}
        </>
      ) : (
        <CreateOrganisationForm />
      )}
    </section>
  )
}

function OrganisationNameForm({
  organisation,
}: {
  organisation: CurrentOrganisation
}) {
  const renameOrganisation = useRenameOrganisation()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [name, setName] = useState(organisation.name)
  const [savedName, setSavedName] = useState(organisation.name)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = name.trim()
  const dirty = trimmed !== savedName
  const canSave = dirty && trimmed.length > 0 && !submitting
  // See the account form: a disabled Save has to be explained by the field.
  const blankError =
    dirty && trimmed.length === 0 ? 'Organisation name is required.' : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !dirty) return
    setError(null)
    setSaved(false)
    if (trimmed.length === 0) {
      setError('Organisation name is required.')
      inputRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const stored = await renameOrganisation.mutateAsync({ name: trimmed })
      setName(stored.name)
      setSavedName(stored.name)
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not rename the organisation. Try again.',
      )
      inputRef.current?.focus()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={handleSubmit}
      noValidate
    >
      <Input
        ref={inputRef}
        label="Organisation name"
        type="text"
        autoComplete="organization"
        required
        maxLength={ORGANISATION_NAME_MAX_LENGTH}
        value={name}
        error={error ?? blankError ?? undefined}
        onChange={(event) => {
          setName(event.target.value)
          setSaved(false)
          setError(null)
        }}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!canSave}>
          Save name
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || submitting}
          onClick={() => {
            setName(savedName)
            setError(null)
            setSaved(false)
            inputRef.current?.focus()
          }}
        >
          Reset
        </Button>
        <SavedNotice message="Organisation name saved." show={saved} />
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </form>
  )
}

function CreateOrganisationForm() {
  const queryClient = useQueryClient()
  const createOrganisation = useCreateOrganisation()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = name.trim()
  const canCreate = trimmed.length > 0 && !submitting

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return
    setError(null)
    if (trimmed.length === 0) {
      setError('Organisation name is required.')
      inputRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      await createOrganisation.mutateAsync({ name: trimmed })
      // The created organisation is merged into the cached /api/me, so this
      // section re-renders with the real organisation rather than navigating
      // the user away from the page they are working in.
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict_detected') {
        setError('You already have an organisation. Refreshing…')
        try {
          await queryClient.refetchQueries({ queryKey: ['current-user'] })
        } catch {
          setError('Could not refresh your account. Reload the page.')
        }
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not create the organisation. Try again.',
        )
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={handleCreate}
      noValidate
    >
      <Input
        ref={inputRef}
        label="Organisation name"
        type="text"
        autoComplete="organization"
        required
        maxLength={ORGANISATION_NAME_MAX_LENGTH}
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setError(null)
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          loading={submitting}
          disabled={!canCreate}
          iconEnd={<ArrowRight size={16} weight="bold" />}
        >
          Create organisation
        </Button>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </form>
  )
}
