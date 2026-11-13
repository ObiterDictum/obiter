import {
  Button,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@obiter/ui'
import { useState } from 'react'
import type {
  MeResponse,
  OrganisationMember,
  UserRole,
} from '@obiter/contracts'
import {
  useOrganisationMembers,
  useUpdateOrganisationMemberRole,
} from '../organisation-membership'
import { initialsOf } from '../format'
import { ErrorNotice, SectionHeading, roleLabel } from './settings-fields'
import { InviteMemberForm, PendingInvites } from './settings-invites'
import { RemoveMemberDialog } from './remove-member-dialog'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
]

export function MembersSection({
  me,
  active,
}: {
  me: MeResponse
  active: boolean
}) {
  const organisation = me.organisation
  const role = me.user.role
  if (!organisation || !role) return null
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
  role: UserRole
  selfId: string
  active: boolean
}) {
  const isOwner = role === 'owner'
  const canManage = isOwner || role === 'admin'
  const members = useOrganisationMembers(organisationId, { enabled: active })
  const updateRole = useUpdateOrganisationMemberRole(organisationId)
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
          description={
            canManage
              ? 'Everyone who can sign in to your organisation.'
              : 'Everyone who can sign in to your organisation. Only owners and admins can manage members.'
          }
        />
        {members.isPending ? (
          <Skeleton className="h-24" />
        ) : members.isError ? (
          <ErrorNotice message="Could not load your organisation's members." />
        ) : members.data && members.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            {updateRole.isError ? (
              <ErrorNotice
                message={
                  updateRole.error instanceof Error
                    ? updateRole.error.message
                    : 'Could not update that role.'
                }
              />
            ) : null}
            <div className="overflow-x-auto">
              <Table className="min-w-[32rem]">
                <THead>
                  <TR>
                    <TH>Member</TH>
                    <TH>Role</TH>
                    {isOwner ? <TH align="end">Remove</TH> : null}
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
                      <TD>
                        {isOwner &&
                        (member.role === 'admin' ||
                          member.role === 'member') ? (
                          <Select
                            ariaLabel={`Role for ${member.name}`}
                            size="compact"
                            className="w-32"
                            options={ROLE_OPTIONS}
                            value={member.role}
                            disabled={updateRole.isPending}
                            onValueChange={(value) => {
                              if (value === 'admin' || value === 'member') {
                                updateRole.mutate({
                                  userId: member.id,
                                  role: value,
                                })
                              }
                            }}
                          />
                        ) : (
                          roleLabel(member.role)
                        )}
                      </TD>
                      {isOwner ? (
                        <TD className="text-end">
                          {member.id === selfId || member.role === 'owner' ? (
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
          </div>
        ) : (
          <p className="text-meta text-muted">No members to show.</p>
        )}
      </div>

      {canManage ? (
        <>
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
        </>
      ) : null}
    </section>
  )
}
