import { Input, Button } from '@obiter/ui'
import { useRef } from 'react'
import {
  USER_NAME_MAX_LENGTH,
  type CurrentOrganisation,
  type CurrentUser,
} from '@obiter/contracts'
import { useUpdateProfile } from '../current-user'
import {
  ErrorNotice,
  ReadOnlyField,
  SavedNotice,
  SectionHeading,
  roleLabel,
} from './settings-fields'
import { useCanonicalNameField } from './use-canonical-name-field'

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
  // The field, its saved baseline and the mutation result are reconciled by one
  // shared policy (`useCanonicalNameField`): a resolved save cannot discard text
  // typed while it was in flight, and a refetched canonical name cannot leave a
  // stale baseline behind. The identity is the user id, so switching account
  // discards the draft rather than carrying it into another person's form.
  const field = useCanonicalNameField({
    identity: user.id,
    canonical: user.name,
    requiredMessage: 'Name is required.',
    failureMessage: 'Could not save your name. Try again.',
    save: async (name) => (await updateProfile.mutateAsync({ name })).name,
    focusField: () => nameRef.current?.focus(),
  })

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
        onSubmit={field.submit}
        noValidate
      >
        <Input
          ref={nameRef}
          label="Name"
          type="text"
          autoComplete="name"
          required
          maxLength={USER_NAME_MAX_LENGTH}
          value={field.value}
          error={field.error ?? field.blankError ?? undefined}
          onChange={(event) => field.setValue(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            loading={field.submitting}
            disabled={!field.canSave}
          >
            Save changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!field.dirty || field.submitting}
            onClick={field.reset}
          >
            Reset
          </Button>
          <SavedNotice message="Name saved." show={field.saved} />
        </div>
        {field.error ? <ErrorNotice message={field.error} /> : null}
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
