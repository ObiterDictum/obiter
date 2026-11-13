import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@obiter/ui'
import { useState } from 'react'
import { useAuth } from '../auth'
import { ErrorNotice } from './settings-fields'

export function ChangeEmailDialog({ onClose }: { onClose: () => void }) {
  const { changeEmail } = useAuth()
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await changeEmail({
        newEmail: newEmail.trim(),
        password,
      })
      if (!result.ok) {
        setError(result.message ?? 'Could not change your email.')
        return
      }
      setPendingEmail(newEmail.trim())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Change sign-in email</DialogTitle>
        <DialogDescription>
          {pendingEmail
            ? `Check ${pendingEmail} to confirm. Your current email keeps working until you do.`
            : 'The new address must be on your current email domain or a domain verified for your organisation. We send a confirmation link to the new address.'}
        </DialogDescription>
        {error ? <ErrorNotice message={error} /> : null}
        {pendingEmail ? null : (
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void confirm()
            }}
            noValidate
          >
            <Input
              label="New email"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </form>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="ghost" disabled={submitting}>
                {pendingEmail ? 'Done' : 'Cancel'}
              </Button>
            }
          />
          {pendingEmail ? null : (
            <Button
              disabled={
                submitting ||
                newEmail.trim().length === 0 ||
                password.length === 0
              }
              loading={submitting}
              onClick={() => void confirm()}
            >
              Send confirmation
            </Button>
          )}
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
