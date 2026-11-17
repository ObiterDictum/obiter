import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@obiter/ui'
import type { StaffBuzzAgent, StaffBuzzResponse } from '@obiter/contracts'
import { PageScaffold } from '../page-scaffold'
import { staffBuzzQueryOptions } from '../staff'
import { buzzAgentLines } from '../staff-buzz-data'
import { ErrorNotice, SectionHeading } from './settings-fields'
import { JoinWorkspace, LinkKey, LinkedKey } from './staff-buzz-access'
import { StaffBuzzMembers } from './staff-buzz-members'
import { StaffGate } from './staff-gate'

export function StaffBuzzRouteView() {
  return (
    <StaffGate>
      <StaffBuzz />
    </StaffGate>
  )
}

function StaffBuzz() {
  const view = useQuery(staffBuzzQueryOptions())
  return (
    <PageScaffold
      title="Buzz"
      description="Join the team's Buzz workspace, see the agents you can reach and set Buzz roles."
    >
      {view.isPending ? (
        <Skeleton className="h-28" />
      ) : view.isError ? (
        <ErrorNotice message="Could not load Buzz access." />
      ) : !view.data.available ? (
        <p className="text-meta text-muted">Buzz access isn't set up yet.</p>
      ) : (
        <div className="@container flex flex-col gap-10">
          <YourAccess
            view={view.data}
            onCheckAgain={() => void view.refetch()}
          />
          <YourAgents agents={view.data.me.agents} />
          {view.data.canManage ? (
            <StaffBuzzMembers members={view.data.members} />
          ) : null}
        </div>
      )}
    </PageScaffold>
  )
}

function YourAccess({
  view,
  onCheckAgain,
}: {
  view: StaffBuzzResponse
  onCheckAgain: () => void
}) {
  if (view.me.status === 'active') {
    return view.me.npub ? (
      <LinkedKey npub={view.me.npub} />
    ) : (
      <ErrorNotice message="Buzz reports an active key with no npub." />
    )
  }
  return (
    <>
      <JoinWorkspace
        notMember={view.me.status === 'not_member'}
        onCheckAgain={onCheckAgain}
      />
      {view.me.status === 'unlinked' ? <LinkKey /> : null}
    </>
  )
}

function YourAgents({ agents }: { agents: StaffBuzzAgent[] }) {
  return (
    <section
      aria-labelledby="buzz-agents-heading"
      className="flex flex-col gap-4"
    >
      <SectionHeading
        id="buzz-agents-heading"
        title="Your agents"
        description="Agents you can reach in Buzz with your current roles."
      />
      <dl className="flex flex-col gap-2 text-meta">
        {buzzAgentLines(agents).map(({ label, line }) => (
          <div key={label} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-ink">{label}</dt>
            <dd className="text-muted">{line}</dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-subtle">
        Only Karl approves Archivist and Usher actions.
      </p>
    </section>
  )
}
