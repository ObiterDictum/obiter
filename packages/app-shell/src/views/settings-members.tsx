import { Button, Skeleton, Table, TBody, TD, TH, THead, TR } from '@obiter/ui'
import { useState } from 'react'
import type { MeResponse, OrganisationMember } from '@obiter/contracts'
import { useOrganisationMembers } from '../organisation-membership'
import { initialsOf } from '../format'
import { ErrorNotice, SectionHeading, roleLabel } from './settings-fields'
import { InviteMemberForm, PendingInvites } from './settings-invites'
import { RemoveMemberDialog } from './remove-member-dialog'

export function MembersSection({
  me,
  active,
}: {
  me: MeResponse
  active: boolean
}) {
  const organisation = me.organisation
  const role = me.user.role
  if (!organisation || (role !== 'owner' && role !== 'admin')) return null
  return (
    <MembersPanel
      organisationId={organisation.id}
      role={role}
      selfId={me.user.id}
      active={active}
    />
  )
}

function MembersPanel({
  organisationId,
  role,
  selfId,
  active,
}: {
  organisationId: string
  role: 'owner' | 'admin'
  selfId: string
  active: boolean
}) {
  const canRemove = role === 'owner'
  const members = useOrganisationMembers(organisationId, { enabled: active })
  const [removing, setRemoving] = useState<OrganisationMember | null>(null)

  return (
    <section
      hidden={!active}
      aria-label="Members"
      className="flex flex-col gap-8"
    >
      {removing ? (
        <RemoveMemberDialog
          organisationId={organisationId}
          member={removing}
          selfId={selfId}
          onClose={() => setRemoving(null)}
        />
      ) : null}

      <div className="flex flex-col gap-6">
        <SectionHeading
          id="settings-members-heading"
          level="h3"
          title="Members"
          description="Everyone who can sign in to your organisation."
        />
        {members.isPending ? (
          <Skeleton className="h-24" />
        ) : members.isError ? (
          <ErrorNotice message="Could not load your organisation's members." />
        ) : members.data && members.data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[32rem]">
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH>Role</TH>
                  {canRemove ? <TH align="end">Remove</TH> : null}
                </TR>
              </THead>
              <TBody>
                {members.data.map((member) => (
                  <TR key={member.id}>
                    <TD>
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="grid size-7 shrink-0 place-items-center rounded-pill bg-fill text-caption text-muted"
                        >
                          {initialsOf(member.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-item text-ink">
                            {member.name}
                          </span>
                          <span className="block truncate text-caption text-subtle">
                            {member.email}
                          </span>
                        </span>
                      </span>
                    </TD>
                    <TD>{roleLabel(member.role)}</TD>
                    {canRemove ? (
                      <TD className="text-end">
                        {member.id === selfId ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemoving(member)}
                          >
                            Remove
                          </Button>
                        )}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="text-meta text-muted">No members to show.</p>
        )}
      </div>

      <div className="flex flex-col gap-6 border-t border-line pt-8">
        <SectionHeading
          id="settings-invite-heading"
          level="h3"
          title="Invite a member"
          description="Send an email invitation to join your organisation."
        />
        <InviteMemberForm organisationId={organisationId} role={role} />
      </div>

      <div className="flex flex-col gap-6 border-t border-line pt-8">
        <SectionHeading
          id="settings-invites-heading"
          level="h3"
          title="Pending invites"
          description="Invitations sent but not yet accepted."
        />
        <PendingInvites organisationId={organisationId} active={active} />
      </div>
    </section>
  )
}
