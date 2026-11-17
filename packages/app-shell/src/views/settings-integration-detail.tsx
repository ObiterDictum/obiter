import { Link } from '@tanstack/react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import { Skeleton } from '@obiter/ui'
import { ArrowLeft } from '@obiter/ui/icons'
import type { StaffBuzzResponse } from '@obiter/contracts'
import type { Integration, IntegrationStatus } from '../integrations-catalogue'
import { IntegrationAccess } from './integration-access'
import { IntegrationCapabilities } from './integration-capabilities'
import { IntegrationDetailHeader } from './integration-detail-header'
import { DisconnectBuzzKey } from './staff-buzz-access'
import { StaffBuzzMembers } from './staff-buzz-members'
import { BuzzAccess } from './staff-buzz'

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
  const planned = status === 'planned'
  const showBuzzAccess = integration.id === 'buzz' && live && canManage

  return (
    <div className="flex flex-col gap-7">
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

      <IntegrationDetailHeader
        integration={integration}
        status={status}
        action={<DetailAction status={status} canManage={canManage} />}
      />

      <div className="grid items-start gap-6 @pane:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <p className="max-w-[68ch] text-meta text-muted">
            {integration.description}
          </p>
          {showBuzzAccess && buzz ? (
            <div className="rounded-lg bg-surface p-6 shadow-sm ring-1 ring-line">
              {buzz.data ? (
                <BuzzAccess
                  view={buzz.data}
                  onCheckAgain={() => void buzz.refetch()}
                />
              ) : (
                <Skeleton className="h-40" />
              )}
            </div>
          ) : (
            <IntegrationCapabilities
              integration={integration}
              enabled={status === 'connected'}
              planned={planned}
            />
          )}
        </div>
        <IntegrationAccess
          integration={integration}
          organisationName={organisationName}
          canManage={canManage}
          approvalOn={live}
        />
      </div>

      {live && canManage && buzz?.data?.canManage ? (
        <div className="rounded-lg bg-surface p-6 shadow-sm ring-1 ring-line">
          <StaffBuzzMembers members={buzz.data.members} />
        </div>
      ) : null}
    </div>
  )
}

function DetailAction({
  status,
  canManage,
}: {
  status: IntegrationStatus
  canManage: boolean
}) {
  if (status === 'checking') return <Skeleton className="h-control w-36" />
  if (status === 'connected' && canManage) return <DisconnectBuzzKey />
  if (status === 'planned') {
    return (
      <span className="inline-flex h-control items-center rounded-md border border-line bg-surface px-3 text-caption text-muted">
        Planned. Not available yet.
      </span>
    )
  }
  return null
}
