import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Select,
} from '@obiter/ui'
import type { CurrentUser, MatterRecord } from '@obiter/contracts'
import { useState } from 'react'
import { ApiError } from '../api'
import { useTransferMatter } from '../matter-ownership'
import { useOrganisationMembers } from '../organisation-membership'
import { ErrorNotice } from './settings-fields'

export function MatterTransferControls({
  matter,
  user,
}: {
  matter: MatterRecord
  user: CurrentUser
}) {
  const [open, setOpen] = useState(false)
  if (
    user.role !== 'owner' &&
    user.role !== 'admin' &&
    user.id !== matter.createdBy
  )
    return null
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Transfer ownership
      </Button>
      {open ? (
        <MatterTransferDialog matter={matter} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

export function MatterTransferDialog({
  matter,
  onClose,
}: {
  matter: MatterRecord
  onClose: () => void
}) {
  const members = useOrganisationMembers(matter.organisationId)
  const transfer = useTransferMatter(matter.id)
  const [newOwner, setNewOwner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const candidates = (members.data ?? []).filter(
    (member) => member.id !== matter.createdBy,
  )
  const ready =
    members.isSuccess && candidates.some((member) => member.id === newOwner)
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
          Choose an active colleague to take ownership of {matter.name}. You
          will not retain access unless you have a separate grant. Other
          colleagues’ shares and history are kept.
        </DialogDescription>
        {error ? <ErrorNotice message={error} /> : null}
        {members.isPending ? <p>Loading active members…</p> : null}
        {members.isError ? (
          <>
            <ErrorNotice message="Could not load active members." />
            <Button onClick={() => void members.refetch()}>Retry</Button>
          </>
        ) : null}
        <Select
          label="New owner"
          placeholder="Choose a colleague"
          value={newOwner ?? undefined}
          disabled={transfer.isPending}
          options={candidates.map((member) => ({
            value: member.id,
            label: `${member.name} · ${member.email}`,
          }))}
          onValueChange={setNewOwner}
        />
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="ghost" disabled={transfer.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            disabled={!ready || transfer.isPending}
            loading={transfer.isPending}
            onClick={async () => {
              if (!ready || !newOwner || transfer.isPending) return
              setError(null)
              try {
                await transfer.mutateAsync({ newOwnerUserId: newOwner })
                onClose()
              } catch (cause) {
                setError(
                  cause instanceof ApiError
                    ? cause.message
                    : 'Could not transfer ownership.',
                )
              }
            }}
          >
            Confirm transfer
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
