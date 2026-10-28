import { Link } from '@tanstack/react-router'
import { Folders } from '@phosphor-icons/react'
import { Badge, EmptyState, Skeleton } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useMattersList } from '../matters'
import { CreateMatterDialog } from './create-matter-dialog'

/**
 * Matters list — backed by GET /api/matters via TanStack Query. Loading, empty,
 * and error states use @obiter/ui (Skeleton, EmptyState). Matter creation posts
 * to the real API and appears in the list via cache invalidation.
 */
export function MattersRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const list = useMattersList()
  const data = list.data ?? []

  const showError =
    list.isError && !list.isLoading
      ? 'Matters could not be loaded. Check your connection and try again.'
      : null

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Matters</h1>
          <p className="text-xs text-muted">
            Private workspaces for documents and review
          </p>
        </div>
        <CreateMatterDialog />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showError ? (
          <div className="p-6">
            <EmptyState title="Couldn’t load matters" body={showError} />
          </div>
        ) : list.isLoading ? (
          <MattersListSkeleton />
        ) : data.length > 0 ? (
          <section aria-label="Matters">
            <p className="px-5 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted sm:px-6">
              {data.length} {data.length === 1 ? 'matter' : 'matters'}
            </p>
            <ul className="flex flex-col gap-0.5 px-2 pb-4 sm:px-3">
              {data.map((matter) => (
                <li key={matter.id}>
                  <Link
                    to="/matters/$matterId"
                    params={{ matterId: matter.id }}
                    className="group flex items-center justify-between gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-raised"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-medium text-ink">
                        {matter.name}
                      </strong>
                      <small className="mt-0.5 block truncate text-[11px] text-muted">
                        {matter.clientReference || 'No reference'}
                        {matter.primaryJurisdiction
                          ? ` · ${matter.primaryJurisdiction}`
                          : ''}
                      </small>
                    </span>
                    <Badge
                      tone={matter.status === 'active' ? 'success' : 'neutral'}
                    >
                      {matter.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<Folders aria-hidden="true" size={24} weight="regular" />}
              title="No matters yet"
              body="Create your first matter to start organising legal documents and review state."
              action={<CreateMatterDialog trigger="Create your first matter" />}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MattersListSkeleton() {
  return (
    <section
      className="flex flex-col gap-0.5 px-2 pt-3 sm:px-3"
      aria-busy="true"
      aria-label="Loading matters"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5"
        >
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </span>
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
      ))}
    </section>
  )
}
