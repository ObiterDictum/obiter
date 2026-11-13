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
import type { OwnedMatter } from '@obiter/contracts'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { useMemberOwnedMatters } from '../matter-ownership'
import {
  useLeaveOrganisation,
  useOrganisationMembers,
} from '../organisation-membership'
import { ErrorNotice } from './settings-fields'

export function LeaveOrganisationDialog({
  organisationId,
  selfId,
  onClose,
}: {
  organisationId: string
  selfId: string
  onClose: () => void
}) {
  const owned = useMemberOwnedMatters(organisationId, selfId)
  const members = useOrganisationMembers(organisationId)
  const leave = useLeaveOrganisation(organisationId)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [owners, setOwners] = useState<Record<string, string>>({})
  const [uncovered, setUncovered] = useState<OwnedMatter[]>([])
  const [error, setError] = useState<string | null>(null)
  const candidates = (members.data ?? []).filter(
    (person) => person.id !== selfId,
  )
  const matters = [
    ...new Map(
      [...(owned.data ?? []), ...uncovered].map((matter) => [
        matter.matterId,
        matter,
      ]),
    ).values(),
  ]
  const ownerOf = (matterId: string) => owners[matterId] ?? ''
  const ready =
    owned.isSuccess &&
    members.isSuccess &&
    matters.every((matter) =>
      candidates.some((person) => person.id === ownerOf(matter.matterId)),
    )

  async function confirm() {
    if (!ready || leave.isPending) return
    setError(null)
    try {
      await leave.mutateAsync({
        transfers: matters.map((matter) => ({
          matterId: matter.matterId,
          newOwnerUserId: ownerOf(matter.matterId),
        })),
      })
      onClose()
      await signOut().catch(() => undefined)
      void navigate({ to: '/sign-in' })
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not leave the organisation.',
      )
      if (
        cause instanceof ApiError &&
        cause.status === 409 &&
        cause.uncoveredMatters
      ) {
        const uncoveredMatters = cause.uncoveredMatters
        setUncovered(uncoveredMatters)
        setOwners((previous) => ({
          ...previous,
          ...Object.fromEntries(
            uncoveredMatters.map((matter) => [matter.matterId, '']),
          ),
        }))
      }
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !leave.isPending) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Leave organisation</DialogTitle>
        <DialogDescription>
          Transfer every matter you own to a colleague, then leave. You will be
          signed out of every device and session. Your account and history are
          kept.
        </DialogDescription>
        {error ? <ErrorNotice message={error} /> : null}
        {owned.isPending || members.isPending ? (
          <p>Loading matters and members…</p>
        ) : null}
        {owned.isError || members.isError ? (
          <>
            <ErrorNotice message="Could not load matters or members. Leaving is blocked." />
            <Button
              onClick={() => {
                void owned.refetch()
                void members.refetch()
              }}
            >
              Retry
            </Button>
          </>
        ) : null}
        {uncovered.length > 0 ? (
          <div role="alert">
            <p>These matters still need an owner:</p>
            <ul>
              {uncovered.map((matter) => (
                <li key={matter.matterId}>{matter.title}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex max-h-96 flex-col gap-4 overflow-y-auto">
          {matters.map((matter) => (
            <Select
              key={matter.matterId}
              label={`New owner for ${matter.title}`}
              value={ownerOf(matter.matterId)}
              disabled={leave.isPending}
              options={[
                { value: '', label: 'Choose an owner' },
                ...candidates.map((person) => ({
                  value: person.id,
                  label: `${person.name} · ${person.email}`,
                })),
              ]}
              onValueChange={(value) =>
                setOwners((previous) => ({
                  ...previous,
                  [matter.matterId]: value ?? '',
                }))
              }
            />
          ))}
        </div>
        {owned.isSuccess && matters.length === 0 ? (
          <p>You own no matters.</p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="ghost" disabled={leave.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="danger"
            disabled={!ready || leave.isPending}
            loading={leave.isPending}
            onClick={() => void confirm()}
          >
            Leave organisation
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
