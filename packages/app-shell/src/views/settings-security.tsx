import { Button } from '@obiter/ui'
import { useRef, useState, type FormEvent } from 'react'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@obiter/contracts'
import { useAuth } from '../auth'
import {
  ErrorNotice,
  PasswordField,
  SavedNotice,
  SectionHeading,
} from './settings-fields'

/**
 * The security section: password change through the existing better-auth
 * boundary. The current password is verified server-side, and the client
 * checks are a courtesy that the API repeats.
 */
export function SecuritySection({ active }: { active: boolean }) {
  const { changePassword } = useAuth()
  const submittingRef = useRef(false)
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const complete =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmation.length > 0

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !complete) return
    setError(null)
    setSaved(false)
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      nextRef.current?.focus()
      return
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      setError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`)
      nextRef.current?.focus()
      return
    }
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.')
      confirmRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = await changePassword({
        currentPassword,
        newPassword,
      })
      if (!result.ok) {
        // The hook maps the machine code to user-facing text, so an unmapped
        // failure still reads as a retryable message rather than API detail.
        setError(result.message ?? 'Could not change your password. Try again.')
        currentRef.current?.focus()
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setSaved(true)
    } catch {
      setError('Could not change your password. Try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section
      hidden={!active}
      aria-labelledby="settings-security-heading"
      className="flex flex-col gap-5"
    >
      <div>
        <SectionHeading
          id="settings-security-heading"
          title="Security"
          description="Change the password you sign in with. Other devices are signed out."
        />
      </div>

      <form
        className="flex max-w-lg flex-col gap-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <PasswordField
          inputRef={currentRef}
          label="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <PasswordField
          inputRef={nextRef}
          label="New password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          helperText={`Use at least ${MIN_PASSWORD_LENGTH} characters, up to ${MAX_PASSWORD_LENGTH}.`}
        />
        <PasswordField
          inputRef={confirmRef}
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            loading={submitting}
            disabled={!complete || submitting}
          >
            Change password
          </Button>
          <SavedNotice
            message="Password changed. Other devices have been signed out."
            show={saved}
          />
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </form>
    </section>
  )
}
