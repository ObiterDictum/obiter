import { Input, Button } from '@obiter/ui'
import { useRef } from 'react'
import { USER_NAME_MAX_LENGTH, type CurrentUser } from '@obiter/contracts'
import { useUpdateProfile } from '../current-user'
import {
  ErrorNotice,
  ReadOnlyField,
  SavedNotice,
  SectionHeading,
} from './settings-fields'
import { useCanonicalNameField } from './use-canonical-name-field'

/**
 * The account section: the name the user is shown under, and the identity
 * facts they cannot change here. The mutation is session-scoped, so this form
 * never sends a user id.
 */
export function AccountSection({
  user,
  active,
}: {
  user: CurrentUser
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
      className="flex flex-col gap-8"
    >
      <div className="flex flex-col gap-6">
        <SectionHeading
          id="settings-account-heading"
          title="Account"
          description="Your name is shown on comments, tracked changes and every matter you share."
        />

        <form
          className="flex max-w-[420px] flex-col gap-4"
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
            helperText="Use the name your colleagues know you by."
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
              variant="ghost"
              disabled={!field.dirty || field.submitting}
              onClick={field.reset}
            >
              Reset
            </Button>
            <SavedNotice message="All changes saved" show={field.saved} />
          </div>
          {field.error ? <ErrorNotice message={field.error} /> : null}
        </form>
      </div>

      <div className="flex flex-col gap-6 border-t border-line pt-8">
        <SectionHeading
          id="settings-email-heading"
          level="h3"
          title="Sign-in email"
          description="The address used for sign-in, invitations and Verify notifications."
        />
        <ReadOnlyField
          label="Email"
          value={user.email}
          helper="Ask your firm administrator to change the email you sign in with."
        />
      </div>
    </section>
  )
}
