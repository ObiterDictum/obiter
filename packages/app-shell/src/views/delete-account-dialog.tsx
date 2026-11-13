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
import type { CurrentUser } from '@obiter/contracts'
import { useAuth } from '../auth'
import { ErrorNotice } from './settings-fields'

export function DeleteAccountDialog({
  user,
  onDeleted,
  onClose,
}: {
  user: CurrentUser
  onDeleted: () => void
  onClose: () => void
}) {
  const { deleteAccount } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const confirmed = confirmation.trim() === user.email

  async function confirm() {
    if (submitting || !confirmed) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await deleteAccount(password)
      if (!result.ok) {
        setError(result.message ?? 'Could not delete your account.')
        return
      }
      onDeleted()
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
        <DialogTitle>Delete account</DialogTitle>
        <DialogDescription>
          This permanently signs you out and removes your access. Matters and
          audit history are retained. Type {user.email} and enter your password
          to confirm.
        </DialogDescription>
        {error ? <ErrorNotice message={error} /> : null}
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
          noValidate
        >
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label={`Type ${user.email} to confirm`}
            type="text"
            autoComplete="off"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </form>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="ghost" disabled={submitting}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="danger"
            disabled={submitting || !confirmed || password.length === 0}
            loading={submitting}
            onClick={() => void confirm()}
          >
            Delete account
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
