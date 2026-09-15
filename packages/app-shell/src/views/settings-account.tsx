import { Input, Button } from '@obiter/ui'
import { useRef, useState, type FormEvent } from 'react'
import {
  USER_NAME_MAX_LENGTH,
  type CurrentOrganisation,
  type CurrentUser,
} from '@obiter/contracts'
import { ApiError } from '../api'
import { useUpdateProfile } from '../current-user'
import {
  ErrorNotice,
  ReadOnlyField,
  SavedNotice,
  SectionHeading,
  roleLabel,
} from './settings-fields'

/**
 * The account section: the name the user is shown under, and the identity
 * facts they cannot change here. The mutation is session-scoped, so this form
 * never sends a user id.
 */
export function AccountSection({
  user,
  organisation,
  active,
}: {
  user: CurrentUser
  organisation: CurrentOrganisation | null
  active: boolean
}) {
  const updateProfile = useUpdateProfile()
  const nameRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [name, setName] = useState(user.name)
  // The baseline is the canonical value the server last confirmed, so "saved"
  // and "changed" are decided against stored state, not against what was typed.
  const [savedName, setSavedName] = useState(user.name)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = name.trim()
  const dirty = trimmed !== savedName
  const canSave = dirty && trimmed.length > 0 && !submitting
  // A blank name disables Save, so the field itself has to say why: an empty
  // required field that only refuses to submit teaches the user nothing.
  const blankError = dirty && trimmed.length === 0 ? 'Name is required.' : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !dirty) return
    setError(null)
    setSaved(false)
    if (trimmed.length === 0) {
      setError('Name is required.')
      nameRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const stored = await updateProfile.mutateAsync({ name: trimmed })
      setName(stored.name)
      setSavedName(stored.name)
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not save your name. Try again.',
      )
      nameRef.current?.focus()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function handleReset() {
    setName(savedName)
    setError(null)
    setSaved(false)
    nameRef.current?.focus()
  }

  return (
    <section
      hidden={!active}
      aria-labelledby="settings-account-heading"
      className="flex flex-col gap-5"
    >
      <div>
        <SectionHeading
          id="settings-account-heading"
          title="Account"
          description="Your name and the email you sign in with. Your name is shown to your organisation."
        />
      </div>

      <form
        className="flex max-w-lg flex-col gap-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <Input
          ref={nameRef}
          label="Name"
          type="text"
          autoComplete="name"
          required
          maxLength={USER_NAME_MAX_LENGTH}
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
            Save changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || submitting}
            onClick={handleReset}
          >
            Reset
          </Button>
          <SavedNotice message="Name saved." show={saved} />
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </form>

      <dl className="flex max-w-lg flex-col gap-4">
        <ReadOnlyField
          label="Email"
          value={user.email}
          helper="Email changes are not supported yet."
        />
        {organisation && user.role ? (
          <ReadOnlyField
            label="Role"
            value={roleLabel(user.role)}
            helper={`Your role in ${organisation.name}.`}
          />
        ) : (
          <ReadOnlyField
            label="Role"
            value="No organisation yet"
            helper="Create one in Organisation settings when you are ready to share work."
          />
        )}
      </dl>
    </section>
  )
}
