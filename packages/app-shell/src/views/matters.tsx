import { Link } from '@tanstack/react-router'
import { Card, EmptyState } from '@ormont/ui'
import type { AppPlatform } from '@ormont/contracts'
import { useSuspenseQuery } from '@tanstack/react-query'
import { findMatterRecord, shellSnapshotQueryOptions } from '../fixtures'

/** Matters list — still the Phase 0 fixture view (M2 rewires to GET /api/matters). */
export function MattersRouteView({ platform }: { platform: AppPlatform }) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))

  return (
    <div className="shell-stack matters-page">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Matters</p>
          <h1 className="shell-header__title">Matters</h1>
        </div>
      </section>

      {data.matters.length > 0 ? (
        <section className="matter-list" aria-label="Matters">
          {data.matters.map((matter) => (
            <Link className="matter-row" key={matter.id} to="/matters/$matterId" params={{ matterId: matter.id }}>
              <span>
                <strong>{matter.name}</strong>
                <small>{matter.clientReference}</small>
              </span>
              <span>{matter.status}</span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="matters-empty">
          <p className="matters-empty__kicker">No matters yet</p>
          <h2>Start from a real matter workspace</h2>
          <p>
            Matter storage, uploads, redaction, drafting, and verification are planned surfaces.
            This page is ready for the first real matter workflow rather than placeholder records.
          </p>
          <div className="matters-empty__actions">
            <Link className="workspace-hero__action" to="/search">Search sources</Link>
            <span>Create matter planned</span>
          </div>
        </section>
      )}
    </div>
  )
}

/** Matter detail — still the Phase 0 fixture view (M2 rewires to real data). */
export function MatterRouteView({
  matterId,
  platform,
}: {
  matterId: string
  platform: AppPlatform
}) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const matter = findMatterRecord(data, matterId)

  if (!matter) {
    return (
      <Card>
        <EmptyState
          title="Matter not found"
          body="This matter does not exist in the current organisation workspace."
          action={<Link className="shell-inline-link" to="/matters">Return to matters</Link>}
        />
      </Card>
    )
  }

  return (
    <div className="shell-stack">
      <Card eyebrow={matter.clientReference} title={matter.name}>
        <p className="shell-copy">{matter.summary}</p>
      </Card>
    </div>
  )
}
