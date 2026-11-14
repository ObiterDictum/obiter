import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
} from '@obiter/ui'
import { useState } from 'react'
import {
  useOrganisationMembers,
  useTransferOrganisationOwnership,
} from '../organisation-membership'
import { ApiError } from '../api'
import { ErrorNotice } from './settings-fields'

export function TransferOwnershipDialog({
  organisationId,
  organisationName,
  selfId,
  onClose,
}: {
  organisationId: string
  organisationName: string
  selfId: string
  onClose: () => void
}) {
  const members = useOrganisationMembers(organisationId)
  const transfer = useTransferOrganisationOwnership(organisationId)
  const [targetId, setTargetId] = useState('')
  const [typedName, setTypedName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const candidates = (members.data ?? []).filter(
    (member) => member.id !== selfId && member.role !== 'owner',
  )
  const ready =
    members.isSuccess &&
    targetId.length > 0 &&
    typedName.trim() === organisationName

  async function confirm() {
    if (!ready || transfer.isPending) return
    setError(null)
    try {
      await transfer.mutateAsync({ userId: targetId })
      onClose()
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not transfer ownership.',
      )
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !transfer.isPending) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Transfer ownership</DialogTitle>
        <DialogDescription>
          The new owner becomes responsible for {organisationName}. You become
          an admin.
        </DialogDescription>
        {error ? <ErrorNotice message={error} /> : null}
        {members.isPending ? <p>Loading members…</p> : null}
        {members.isError ? (
          <>
            <ErrorNotice message="Could not load members. Transfer is blocked." />
            <Button onClick={() => void members.refetch()}>Retry</Button>
          </>
        ) : null}
        {members.isSuccess && candidates.length === 0 ? (
          <p>No other active members can take ownership.</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-4">
          <Select
            label="New owner"
            value={targetId}
            disabled={transfer.isPending}
            options={[
              { value: '', label: 'Choose a member' },
              ...candidates.map((member) => ({
                value: member.id,
                label: `${member.name} · ${member.email}`,
              })),
            ]}
            onValueChange={(value) => setTargetId(value ?? '')}
          />
          <Input
            label={`Type ${organisationName} to confirm`}
            type="text"
            autoComplete="off"
            value={typedName}
            disabled={transfer.isPending}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="ghost" disabled={transfer.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="danger"
            disabled={!ready || transfer.isPending}
            loading={transfer.isPending}
            onClick={() => void confirm()}
          >
            Transfer ownership
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
