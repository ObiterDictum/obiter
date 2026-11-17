import {
  STAFF_BUZZ_AGENT_ACCESS,
  type StaffBuzzAgent,
  type StaffBuzzRole,
  type StaffBuzzStatus,
} from '@obiter/contracts'

export const BUZZ_STATUS_LABELS = {
  unlinked: 'Not linked',
  not_member: 'Not joined yet',
  active: 'Active',
} as const satisfies Record<StaffBuzzStatus, string>

export const BUZZ_ROLE_LABELS = {
  operations: 'Operations',
  corpus: 'Corpus',
} as const satisfies Record<StaffBuzzRole, string>

const BUZZ_ROLE_ORDER = ['operations', 'corpus'] as const

const BUZZ_AGENT_LINES = {
  Clerk: 'routes requests',
  Reporter: 'UK law',
  Scribe: 'writing',
  Examiner: 'PR reviews',
  Registrar: 'ops status',
  Archivist: 'Find Case Law notices',
} as const satisfies Record<StaffBuzzAgent, string>

export function buzzAgentLines(agents: readonly StaffBuzzAgent[]) {
  return agents.map((agent) => {
    const access = STAFF_BUZZ_AGENT_ACCESS[agent]
    return {
      label:
        access === 'staff'
          ? agent
          : `${agent} (${BUZZ_ROLE_LABELS[access]} role)`,
      line: BUZZ_AGENT_LINES[agent],
    }
  })
}

export function shortNpub(npub: string) {
  return npub.length <= 16 ? npub : `${npub.slice(0, 9)}…${npub.slice(-4)}`
}

export function roleList(
  current: readonly StaffBuzzRole[],
  role: StaffBuzzRole,
  enabled: boolean,
) {
  const roles = new Set(current)
  if (enabled) roles.add(role)
  else roles.delete(role)
  return BUZZ_ROLE_ORDER.filter((item) => roles.has(item))
}
