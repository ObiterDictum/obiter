import { Input, Button } from '@obiter/ui'
import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { USER_NAME_MAX_LENGTH, type CurrentUser } from '@obiter/contracts'
import { useUpdateProfile } from '../current-user'
import {
  ErrorNotice,
  ReadOnlyField,
  SavedNotice,
  SectionHeading,
} from './settings-fields'
import { SignedInDevices } from './settings-sessions'
import { useCanonicalNameField } from './use-canonical-name-field'
import { ChangeEmailDialog } from './change-email-dialog'
import { DeleteAccountDialog } from './delete-account-dialog'

export function AccountSection({
  user,
  active,
}: {
  user: CurrentUser
  active: boolean
}) {
  const updateProfile = useUpdateProfile()
  const navigate = useNavigate()
  const [changingEmail, setChangingEmail] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
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
      aria-label="Account"
      className="flex flex-col gap-8"
    >
      <div className="flex flex-col gap-6">
        <SectionHeading
          id="settings-profile-heading"
          level="h3"
          title="Profile"
          description="Your name is shown on comments, tracked changes and every matter you share."
        />

        <form
          className="flex max-w-[480px] flex-col gap-4"
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
            <SavedNotice message="Saved" show={field.saved} />
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
        {changingEmail ? (
          <ChangeEmailDialog onClose={() => setChangingEmail(false)} />
        ) : null}
        <dl className="max-w-[480px]">
          <ReadOnlyField
            label="Email"
            value={user.email}
            helper="The new address must be on your current email domain or a domain verified for your organisation."
          />
        </dl>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setChangingEmail(true)}
          >
            Change email
          </Button>
        </div>
      </div>

      <SignedInDevices active={active} />

      <div className="flex max-w-[480px] flex-col gap-4 border-t border-line pt-8">
        <SectionHeading
          id="settings-delete-heading"
          level="h3"
          title="Delete account"
          description="Permanently remove your access to Obiter. Matters and audit history are retained."
        />
        {deleting ? (
          <DeleteAccountDialog
            user={user}
            onClose={() => setDeleting(false)}
            onDeleted={() => void navigate({ to: '/sign-in' })}
          />
        ) : null}
        <div>
          <Button
            type="button"
            variant="danger"
            onClick={() => setDeleting(true)}
          >
            Delete account
          </Button>
        </div>
      </div>
    </section>
  )
}
