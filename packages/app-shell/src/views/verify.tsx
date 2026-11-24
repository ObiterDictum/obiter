import { useState } from 'react'
import { Link } from '@tanstack/react-router'
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
import { ShieldCheck } from '@obiter/ui/icons'
import { useCurrentUser } from '../current-user'
import { useCitationTargets } from '../documents'
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

export function VerifyRouteView({ matterId }: { matterId?: string } = {}) {
  const { data: me } = useCurrentUser()
  const hasOrganisation = me?.organisation != null
  const runs = useOrganisationVerificationRuns(hasOrganisation)
  const matters = useMattersList({ enabled: hasOrganisation })
  const documents = useVerificationRunDocuments(runs.runs)
  const [filter, setFilter] = useState<VerifyFilter>('all')

  const groups = buildVerifyGroups({
    runs: runs.runs,
    matters: matters.data ?? [],
    documents,
  }).filter((group) => !matterId || group.matterId === matterId)
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
              search={{ section: 'organisation' }}
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
        <>
          <VerifyDocuments matterId={matterId} />
          <EmptyState
            icon={<ShieldCheck size={28} className="text-muted" />}
            title={
              matterId
                ? 'Nothing verified in this matter'
                : 'No verification runs yet'
            }
            body={
              matterId
                ? 'Verify checks a document’s citations, quotations and authorities against stored UK sources. Choose a document above and run it, or start one from the document itself.'
                : 'Verify checks a document’s citations, quotations and authorities against stored UK sources. Choose a document above and run it, or open a document in a matter.'
            }
            action={
              <Link
                to={matterId ? '/matters/$matterId' : '/matters'}
                params={matterId ? { matterId } : undefined}
                className="font-semibold text-brand hover:text-brand-pressed"
              >
                {matterId ? 'Back to the matter' : 'Open matters'}
              </Link>
            }
          />
        </>
      ) : (
        <>
          <VerifyDocuments matterId={matterId} />
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

const VERIFY_DOCUMENT_LIMIT = 8

function VerifyDocuments({ matterId }: { matterId?: string }) {
  const targets = useCitationTargets()
  const documents = (targets.data ?? [])
    .filter((document) => !matterId || document.matterId === matterId)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, VERIFY_DOCUMENT_LIMIT)
  if (documents.length === 0) return null
  return (
    <Card aria-labelledby="verify-documents">
      <CardHead titleId="verify-documents" title="Documents">
        <span className="text-caption text-subtle">
          In a document, Verify lives in the Review tab’s Checks group.
        </span>
      </CardHead>
      <ul className="flex flex-col pb-2">
        {documents.map((document) => (
          <li
            key={document.documentId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2.5 [&+li]:border-t [&+li]:border-line"
          >
            <div className="min-w-0 flex-1">
              <Link
                to="/matters/$matterId/documents/$documentId"
                params={{
                  matterId: document.matterId,
                  documentId: document.documentId,
                }}
                search={{ verify: 'open' }}
                className="block truncate text-item text-ink hover:text-brand"
              >
                {document.filename}
              </Link>
              {!matterId ? (
                <span className="text-caption text-subtle">
                  {document.matterName}
                </span>
              ) : null}
            </div>
            <Link
              to="/matters/$matterId/documents/$documentId"
              params={{
                matterId: document.matterId,
                documentId: document.documentId,
              }}
              search={{ verify: 'run' }}
              className="shrink-0 text-meta font-semibold text-brand hover:text-brand-pressed"
            >
              Run Verify
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
