import { Link } from '@tanstack/react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import { Skeleton, Switch, cn } from '@obiter/ui'
import { ArrowLeft } from '@obiter/ui/icons'
import type { StaffBuzzResponse } from '@obiter/contracts'
import type { Integration, IntegrationStatus } from '../integrations-catalogue'
import { integrationHex, IntegrationTile } from './integration-tile'
import { IntegrationStatusBadge } from './integration-status'
import { ReadOnlyField, SectionHeading } from './settings-fields'
import { DisconnectBuzzKey } from './staff-buzz-access'
import { StaffBuzzMembers } from './staff-buzz-members'
import { BuzzAccess } from './staff-buzz'

const APPROVAL = 'Ask before the agent sends or changes anything'
const AUDIT_NOTE =
  'Every action the agent takes through this integration is recorded in the matter history.'

function ignore() {}

export function IntegrationDetail({
  integration,
  status,
  organisationName,
  canManage,
  buzz,
}: {
  integration: Integration
  status: IntegrationStatus
  organisationName: string
  canManage: boolean
  buzz?: UseQueryResult<StaffBuzzResponse>
}) {
  const live = status === 'connected' || status === 'available'
  const hex = integrationHex(integration)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          to="/settings"
          search={{ section: 'integrations' }}
          className="inline-flex items-center gap-1.5 rounded text-meta text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft size={14} aria-hidden />
          All integrations
        </Link>
      </div>

      <header
        className="relative overflow-hidden rounded-xl bg-surface p-7 ring-1 ring-line"
        aria-labelledby="integration-name"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-16 size-64 rounded-pill opacity-[0.1] blur-3xl"
          style={{
            background: `light-dark(${hex}, color-mix(in srgb, ${hex} 55%, white))`,
          }}
        />
        <div className="relative flex flex-col gap-5 @[44rem]:flex-row @[44rem]:items-start @[44rem]:gap-6">
          <IntegrationTile integration={integration} size="detail" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="integration-name" className="text-page text-ink">
                {integration.name}
              </h2>
              <IntegrationStatusBadge status={status} />
            </div>
            <p className="mt-2 max-w-[64ch] text-body text-muted">
              {integration.description}
            </p>
          </div>
          <div className="shrink-0 @[44rem]:pt-2">
            {status === 'connected' && canManage ? (
              <DisconnectBuzzKey />
            ) : status === 'available' ||
              status === 'connected' ? null : status === 'checking' ? (
              <Skeleton className="h-control w-36" />
            ) : (
              <span className="inline-flex h-control items-center rounded-md border border-line px-3 text-caption text-muted">
                Planned. Not available yet.
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-8 @pane:grid-cols-[minmax(0,1fr)_19rem]">
        {integration.id === 'buzz' &&
        status !== 'planned' &&
        canManage &&
        buzz ? (
          buzz.data ? (
            <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-line">
              <BuzzAccess
                view={buzz.data}
                onCheckAgain={() => void buzz.refetch()}
              />
            </div>
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <Capabilities
            integration={integration}
            enabled={status === 'connected'}
          />
        )}
        <AccessAndSafety
          integration={integration}
          organisationName={organisationName}
          canManage={canManage}
          approvalOn={live}
        />
      </div>

      {live && canManage && buzz?.data?.canManage ? (
        <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-line">
          <StaffBuzzMembers members={buzz.data.members} />
        </div>
      ) : null}
    </div>
  )
}

function Capabilities({
  integration,
  enabled,
}: {
  integration: Integration
  enabled: boolean
}) {
  return (
    <section
      aria-labelledby="integration-capabilities-heading"
      className="flex flex-col gap-4"
    >
      <SectionHeading
        id="integration-capabilities-heading"
        level="h3"
        title="What the agent can do"
        description="Each ability you allow is one the agent may use in your matters."
      />
      <ul className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-line">
        {integration.capabilities.map((capability, index) => (
          <li
            key={capability.title}
            className={cn(
              'flex items-start justify-between gap-6 px-6 py-4',
              index > 0 && 'border-t border-line',
            )}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-item text-ink">{capability.title}</p>
              <p className="text-meta text-muted">{capability.description}</p>
            </div>
            <Switch
              label={capability.title}
              checked={enabled}
              onCheckedChange={ignore}
              disabled
              className="mt-0.5 shrink-0 aria-disabled:pointer-events-none aria-disabled:opacity-45"
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function AccessAndSafety({
  integration,
  organisationName,
  canManage,
  approvalOn,
}: {
  integration: Integration
  organisationName: string
  canManage: boolean
  approvalOn: boolean
}) {
  return (
    <aside
      aria-labelledby="integration-access-heading"
      className="flex flex-col gap-6 rounded-xl bg-surface p-6 shadow-sm ring-1 ring-line"
    >
      <SectionHeading
        id="integration-access-heading"
        level="h3"
        title="Access and safety"
        description="Who may use it, and what leaves Obiter."
      />
      <dl>
        <ReadOnlyField
          label="Who can use it"
          value={`All members of ${organisationName}`}
          helper={
            canManage ? undefined : 'Only an owner or admin can change this.'
          }
        />
      </dl>
      <div className="border-t border-line pt-5">
        <Switch
          label={APPROVAL}
          checked
          onCheckedChange={ignore}
          disabled
          className={cn(
            '-ml-2 aria-disabled:pointer-events-none',
            approvalOn ? undefined : 'aria-disabled:opacity-45',
          )}
        >
          {APPROVAL}
        </Switch>
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-5">
        <p className="text-meta text-ink">What leaves Obiter</p>
        <p className="text-meta text-muted">{integration.dataLeaves}</p>
      </div>
      <p className="border-t border-line pt-5 text-caption text-subtle">
        {AUDIT_NOTE}
      </p>
    </aside>
  )
}
