import { SourcePageLinks } from './SourcePageLinks'
import { LegislationActReader } from './LegislationActReader'
import { useQuery } from '@tanstack/react-query'
import { Button, Skeleton, StatusDot } from '@obiter/ui'
import { ContentFrame } from '../content-frame'
import { PageScaffold } from '../page-scaffold'
import { sourceNameForUrl } from '../components/search/provenance'
import { formatDate } from '../format'
import { legislationStatusDisplay } from '../legislation-status'
import { legislationActQueryOptions } from './legislation-document-query'

export { legislationActQueryOptions }
export type { LegislationActResponse } from './legislation-document-query'

export function LegislationActView({
  identity,
  hash = '',
}: {
  identity: string
  hash?: string
}) {
  const query = useQuery(legislationActQueryOptions(identity))

  if (query.isPending) {
    return (
      <ContentFrame className="flex flex-col gap-6 py-14" aria-busy="true">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-96" />
        <span className="sr-only">Loading the Act…</span>
      </ContentFrame>
    )
  }

  if (query.isError) {
    return (
      <ContentFrame className="flex flex-col items-start gap-4 py-14">
        <div>
          <p className="mb-1 text-meta text-subtle">UK Public General Acts</p>
          <h1 className="text-page text-ink">Act could not be loaded</h1>
          <p className="mt-2 max-w-[68ch] text-body text-muted">
            legislation.gov.uk or the stored Act did not answer. The text has
            not been guessed or substituted.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </ContentFrame>
    )
  }

  const act = query.data.act
  const sourceName = sourceNameForUrl(act.sourceUrl)
  const repealedAct = act.status === 'repealed'

  return (
    <PageScaffold
      eyebrow="UK Public General Acts"
      title={act.title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{act.chapter}</span>
          <span aria-hidden>·</span>
          <span>{act.extent ? act.extent : 'Extent not recorded'}</span>
          <span aria-hidden>·</span>
          {repealedAct ? (
            <StatusDot tone="neutral">
              {legislationStatusDisplay('repealed', act.repealedFrom).label}
            </StatusDot>
          ) : (
            <span>
              {act.totalCount}{' '}
              {act.totalCount === 1 ? 'provision' : 'provisions'}
            </span>
          )}
          <span aria-hidden>·</span>
          <span>Point-in-time date not recorded</span>
        </span>
      }
      actions={<SourcePageLinks sourceUrl={act.officialUrl} />}
    >
      <div className="space-y-2 text-meta text-muted">
        <p>
          Source{' '}
          <a
            className="text-ink underline underline-offset-2"
            href={act.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {sourceName}
          </a>
          {' · '}
          {act.acquiredAt
            ? `Retrieved ${formatDate(act.acquiredAt)}`
            : 'Retrieval date not recorded'}
          {act.enactmentDate
            ? ` · Royal Assent ${formatDate(act.enactmentDate)}`
            : ''}
        </p>
        <p>Check legislation.gov.uk before relying on the stored version.</p>
        {act.withheldCount > 0 ? (
          <p className="rounded-md bg-warning-soft px-4 py-3 text-ink">
            {act.withheldCount} of {act.totalCount} provisions have wording
            withheld. They appear in document order with a link to the official
            revised text.
          </p>
        ) : null}
      </div>
      <LegislationActReader key={act.identity} act={act} hash={hash} />
    </PageScaffold>
  )
}
