import { Users } from '@phosphor-icons/react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Select,
  useToast,
} from '@obiter/ui'
import type { MatterAccessLevel } from '@obiter/contracts'
import { useState } from 'react'
import { initialsOf } from '../format'
import {
  useGrantMatterShare,
  useMatterShares,
  useRevokeMatterShare,
} from '../matter-shares'
import type { MatterRecord } from '../matters'
import { useOrganisationMembers } from '../organisation-membership'

const ACCESS_OPTIONS = [
  { value: 'view', label: 'Can view' },
  { value: 'edit', label: 'Can edit' },
]

/**
 * Who can open this matter, from the API that owns access. Only the matter's
 * owner may read or change grants, so the caller offers the dialog only to them.
 * A grant carries the grantee's user id, so names come from the organisation's
 * member list — the same read Settings uses.
 */
export function MatterShareDialog({
  matter,
  organisationId,
}: {
  matter: MatterRecord
  organisationId: string | null
}) {
  const [open, setOpen] = useState(false)
  const shares = useMatterShares(matter.id, { enabled: open })
  // A member who owns a matter cannot list colleagues: the member list needs an
  // owner or administrator. The grants still read, so the list stands and the
  // add form explains why it is absent.
  const members = useOrganisationMembers(organisationId ?? '', {
    enabled: open && organisationId !== null,
  })

  const people = shares.data?.shares ?? []
  const owner = members.data?.find(
    (member) => member.id === shares.data?.ownerUserId,
  )
  const sharedIds = new Set(people.map((share) => share.granteeUserId))
  const addable = (members.data ?? []).filter(
    (member) =>
      !sharedIds.has(member.id) && member.id !== shares.data?.ownerUserId,
  )
  const access = shares.data ? people.length + 1 : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="md" iconStart={<Users size={16} />}>
            Share
          </Button>
        }
      />
      <DialogContent size="md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <DialogTitle>Share this matter</DialogTitle>
            <DialogDescription>
              Only the people listed here can open {matter.name}. Members of
              your organisation only; they see every document and version.
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <p className="text-meta text-subtle">
            {access === null
              ? 'Reading access…'
              : `Access: ${access} named ${access === 1 ? 'person' : 'people'}`}
          </p>

          {shares.isError ? (
            <p className="text-meta text-danger">
              {shares.error.message ||
                'This matter’s access list could not be loaded.'}
            </p>
          ) : shares.isPending ? (
            <p className="text-meta text-subtle">Reading access…</p>
          ) : (
            <ul className="flex flex-col">
              <li className="flex items-center gap-3 border-b border-line py-3">
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-pill bg-brand text-caption text-brand-fg"
                >
                  {initialsOf(owner?.name ?? 'You')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-item text-ink">
                    {owner?.name ?? 'The matter owner'}
                    <span className="text-muted"> (you)</span>
                  </span>
                  {owner ? (
                    <span className="block truncate text-caption text-subtle">
                      {owner.email}
                    </span>
                  ) : null}
                </span>
                <span className="text-meta text-subtle">Owner</span>
              </li>
              {people.map((share) => {
                const member = members.data?.find(
                  (candidate) => candidate.id === share.granteeUserId,
                )
                return (
                  <ShareRow
                    key={share.id}
                    matterId={matter.id}
                    shareId={share.id}
                    name={member?.name ?? null}
                    email={member?.email ?? null}
                    level={share.accessLevel}
                  />
                )
              })}
            </ul>
          )}

          {addable.length > 0 ? (
            <AddPersonForm matterId={matter.id} members={addable} />
          ) : members.data ? (
            <p className="text-meta text-subtle">
              Everyone already has access.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end">
          <DialogClose render={<Button variant="primary">Done</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A grant whose grantee is no longer in the member list still shows its access
 * level and can be removed: access must be revocable even when the person's name
 * is no longer readable.
 */
function ShareRow({
  matterId,
  shareId,
  name,
  email,
  level,
}: {
  matterId: string
  shareId: string
  name: string | null
  email: string | null
  level: MatterAccessLevel
}) {
  const revoke = useRevokeMatterShare(matterId)
  const { toast } = useToast()
  return (
    <li className="flex items-center gap-3 border-b border-line py-3">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-pill bg-fill text-caption text-muted"
      >
        {name ? initialsOf(name) : '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-item text-ink">
          {name ?? 'A person outside your member list'}
        </span>
        {email ? (
          <span className="block truncate text-caption text-subtle">
            {email}
          </span>
        ) : null}
      </span>
      <span className="text-meta text-subtle">
        {level === 'edit' ? 'Can edit' : 'Can view'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        loading={revoke.isPending}
        onClick={() =>
          revoke.mutate(shareId, {
            onError: (error) =>
              toast({
                title: 'Could not remove access',
                description: error.message,
                tone: 'danger',
              }),
          })
        }
      >
        Remove
      </Button>
    </li>
  )
}

/** The add form only offers members who do not already have access. */
function AddPersonForm({
  matterId,
  members,
}: {
  matterId: string
  members: Array<{ id: string; name: string; email: string }>
}) {
  const grant = useGrantMatterShare(matterId)
  const { toast } = useToast()
  const [grantee, setGrantee] = useState<string | null>(null)
  const [level, setLevel] = useState<MatterAccessLevel>('view')

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <Select
          label="Add a colleague"
          placeholder="Choose a person"
          options={members.map((member) => ({
            value: member.id,
            label: `${member.name} · ${member.email}`,
          }))}
          value={grantee ?? undefined}
          onValueChange={setGrantee}
        />
      </div>
      <Select
        className="w-32"
        label="Access"
        options={ACCESS_OPTIONS}
        value={level}
        onValueChange={(next) => {
          if (next === 'view' || next === 'edit') setLevel(next)
        }}
      />
      <Button
        variant="secondary"
        disabled={grantee === null}
        loading={grant.isPending}
        onClick={() => {
          if (!grantee) return
          grant.mutate(
            { granteeUserId: grantee, accessLevel: level },
            {
              onSuccess: () => {
                toast({ title: 'Access granted', tone: 'success' })
                setGrantee(null)
              },
              onError: (error) =>
                toast({
                  title: 'Could not grant access',
                  description: error.message,
                  tone: 'danger',
                }),
            },
          )
        }}
      >
        Add
      </Button>
    </div>
  )
}
