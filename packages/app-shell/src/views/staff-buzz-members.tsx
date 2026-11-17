import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Table, TBody, TD, TH, THead, TR } from '@obiter/ui'
import type { StaffBuzzMember, StaffBuzzRole } from '@obiter/contracts'
import { ApiError } from '../api'
import { staffBuzzRolesMutationOptions } from '../staff'
import {
  BUZZ_ROLE_LABELS,
  BUZZ_STATUS_LABELS,
  roleList,
} from '../staff-buzz-data'
import { ErrorNotice, SectionHeading } from './settings-fields'

const ROLE_COLUMNS = ['operations', 'corpus'] as const

export function StaffBuzzMembers({ members }: { members: StaffBuzzMember[] }) {
  const roles = useMutation(staffBuzzRolesMutationOptions())
  const [drafts, setDrafts] = useState<Record<string, StaffBuzzRole[]>>({})
  const pendingId = roles.isPending ? roles.variables?.userId : undefined

  function toggle(
    member: StaffBuzzMember,
    role: StaffBuzzRole,
    enabled: boolean,
  ) {
    const next = roleList(drafts[member.userId] ?? member.roles, role, enabled)
    setDrafts((previous) => ({ ...previous, [member.userId]: next }))
    roles.mutate(
      { userId: member.userId, roles: next },
      {
        onSettled: () =>
          setDrafts((previous) => {
            const remaining = { ...previous }
            delete remaining[member.userId]
            return remaining
          }),
      },
    )
  }

  return (
    <section
      aria-labelledby="buzz-members-heading"
      className="flex flex-col gap-4"
    >
      <SectionHeading
        id="buzz-members-heading"
        title="Buzz members"
        description="Every staff member's Buzz status and roles."
      />
      {members.length === 0 ? (
        <p className="text-meta text-muted">No staff members yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[40rem]">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Buzz status</TH>
                {ROLE_COLUMNS.map((role) => (
                  <TH key={role}>{BUZZ_ROLE_LABELS[role]}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {members.map((member) => {
                const rowRoles = drafts[member.userId] ?? member.roles
                return (
                  <TR key={member.userId}>
                    <TD>{member.name}</TD>
                    <TD>{member.email}</TD>
                    <TD>{BUZZ_STATUS_LABELS[member.status]}</TD>
                    {ROLE_COLUMNS.map((role) => (
                      <TD key={role}>
                        <input
                          type="checkbox"
                          className="size-4 accent-brand"
                          aria-label={`${BUZZ_ROLE_LABELS[role]} for ${member.name}`}
                          checked={rowRoles.includes(role)}
                          disabled={pendingId === member.userId}
                          onChange={(event) =>
                            toggle(member, role, event.target.checked)
                          }
                        />
                      </TD>
                    ))}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      )}
      {roles.isError ? (
        <ErrorNotice
          message={
            roles.error instanceof ApiError
              ? roles.error.message
              : 'Could not update Buzz roles. Try again.'
          }
        />
      ) : null}
    </section>
  )
}
