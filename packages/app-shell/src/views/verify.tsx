import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ShieldCheck } from '@phosphor-icons/react'
import {
  Button,
  Card,
  CardHead,
  EmptyState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import { useMattersList } from '../matters'
import { PageScaffold } from '../page-scaffold'
import {
  useOrganisationVerificationRuns,
  useVerificationRunDocuments,
} from '../verification-runs'
import { VerifyDocument } from './verify-document'
import {
  buildVerifyGroups,
  groupMatchesFilter,
  isVerifyFilter,
  verifyFilterCounts,
  type VerifyFilter,
} from './verify-groups'

const verifyFilterOrder: readonly VerifyFilter[] = [
  'all',
  'flagged',
  'review',
  'unchecked',
  'match',
]

const filterLabels = {
  all: 'All checks',
  flagged: 'Flagged',
  review: 'Needs review',
  unchecked: 'Not checked',
  match: 'Matches',
} satisfies Record<VerifyFilter, string>

/**
 * Verify: every finding in the organisation, grouped by matter and then by
 * document, with the version each result checked and the state of a run that has
 * not finished. The counts stay apart — a match is not an approval, a check that
 * did not run is not a pass, and a dismissed finding is a person's decision
 * rather than a clean result.
 */
export function VerifyRouteView() {
  const { data: me } = useCurrentUser()
  // `/api/me` is a suspense query, so a real render has `me`; the branch is
  // explicit so an unresolved account is never treated as organisationless.
  const hasOrganisation = me?.organisation != null
  // A disabled infinite query stays `isPending` forever, so an organisationless
  // account would show a permanent loading skeleton. The query is only enabled
  // once an organisation exists and the view no longer reads its pending state
  // in that case.
  const runs = useOrganisationVerificationRuns(hasOrganisation)
  const matters = useMattersList({ enabled: hasOrganisation })
  const documents = useVerificationRunDocuments(runs.runs)
  const [filter, setFilter] = useState<VerifyFilter>('all')

  const groups = buildVerifyGroups({
    runs: runs.runs,
    matters: matters.data ?? [],
    documents,
  })
  const counts = verifyFilterCounts(groups)
  const shownGroups = groups
    .map((matter) => ({
      ...matter,
      documents: matter.documents.filter((document) =>
        groupMatchesFilter(document, filter),
      ),
    }))
    .filter((matter) => matter.documents.length > 0)

  return (
    <PageScaffold
      title="Verify"
      description="Citations, authorities and quotations checked against stored UK sources. A match is not legal approval."
    >
      {!me ? (
        <p role="status" aria-live="polite" className="text-meta text-muted">
          Loading your account…
        </p>
      ) : !hasOrganisation ? (
        <EmptyState
          icon={<ShieldCheck size={28} className="text-muted" />}
          title="No organisation yet"
          body="Verification runs are scoped to an organisation. Create one, then start a run from a document."
          action={
            <Link
              to="/settings"
              className="font-semibold text-brand hover:text-brand-pressed"
            >
              Open settings
            </Link>
          }
        />
      ) : runs.isPending ? (
        <Skeleton className="h-24" aria-label="Loading verification runs" />
      ) : runs.isError ? (
        <EmptyState
          icon={<ShieldCheck size={28} className="text-muted" />}
          title="Verification runs are unavailable"
          body={runs.error.message}
          action={
            <Button variant="secondary" onClick={() => void runs.refetch()}>
              Retry
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={28} className="text-muted" />}
          title="No verification runs yet"
          body="Verification starts from a document, not from this page. Open a matter, open a document, then use Run verification there."
          action={
            <Link
              to="/matters"
              className="font-semibold text-brand hover:text-brand-pressed"
            >
              Open matters
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={filter}
              onValueChange={(value) => {
                if (isVerifyFilter(value)) setFilter(value)
              }}
            >
              <TabsList aria-label="Filter findings">
                {verifyFilterOrder.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {filterLabels[value]}{' '}
                    <span className="tabular-nums">{counts[value]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-caption text-subtle">
              Grouped by matter, then document. Every result names the version
              it checked.
            </p>
          </div>

          {shownGroups.length === 0 ? (
            <p className="text-body text-muted">
              No finding matches this filter. Dismissed findings are listed
              under All checks.
            </p>
          ) : (
            shownGroups.map((matter) => (
              <Card key={matter.matterId} aria-labelledby={matter.matterId}>
                <CardHead
                  titleId={matter.matterId}
                  title={
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {matter.name}
                      {matter.reference ? (
                        <span className="font-mono text-caption text-subtle">
                          {matter.reference}
                        </span>
                      ) : null}
                    </span>
                  }
                >
                  <span className="text-caption text-subtle">
                    {matter.documents.length === 1
                      ? '1 document checked'
                      : `${String(matter.documents.length)} documents checked`}
                  </span>
                </CardHead>
                <div className="flex flex-col pb-2">
                  {matter.documents.map((document) => (
                    <VerifyDocument
                      key={document.documentId}
                      group={document}
                      filter={filter}
                      currentUserId={me.user.id}
                    />
                  ))}
                </div>
              </Card>
            ))
          )}

          {runs.hasNextPage ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                loading={runs.isFetchingNextPage}
                onClick={() => void runs.fetchNextPage()}
              >
                Load more runs
              </Button>
            </div>
          ) : null}
        </>
      )}
    </PageScaffold>
  )
}
