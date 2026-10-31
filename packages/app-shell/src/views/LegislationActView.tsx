import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Button,
  Card,
  CardBody,
  CardHead,
  Skeleton,
  StatusDot,
  buttonClassName,
} from '@obiter/ui'
import { ArrowUpRight } from '@obiter/ui/icons'
import { ContentFrame } from '../content-frame'
import { PageScaffold } from '../page-scaffold'
import { provisionResultLocation } from '../legislation-navigation'
import { sourceNameForUrl } from '../components/search/provenance'
import { formatDate } from '../format'
import {
  legislationActQueryOptions,
  type LegislationActContentsKind,
  type LegislationActContentsNode,
} from './legislation-document-query'

export { legislationActQueryOptions }
export type { LegislationActResponse } from './legislation-document-query'

const containerKinds = new Set<LegislationActContentsKind>([
  'part',
  'chapter',
  'schedule',
  'crossheading',
])

function isContainerKind(kind: LegislationActContentsKind): boolean {
  return containerKinds.has(kind)
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'provision' : 'provisions'}`
}

function ActContentsItem({
  node,
  documentIdentity,
}: {
  node: LegislationActContentsNode
  documentIdentity: string
}) {
  if (isContainerKind(node.kind)) {
    return (
      <li>
        <div className="flex flex-col gap-0.5 py-2 pl-2">
          <span className="text-item text-ink">{node.label}</span>
          {node.text && node.text !== node.label ? (
            <span className="text-meta text-muted">{node.text}</span>
          ) : null}
        </div>
        {node.children.length > 0 ? (
          <ul className="ml-2 flex flex-col border-l border-line pl-2">
            {node.children.map((child) => (
              <ActContentsItem
                key={child.labelPath}
                node={child}
                documentIdentity={documentIdentity}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }
  return (
    <li>
      <Link
        {...provisionResultLocation({
          documentIdentity,
          labelPath: node.labelPath,
          canonicalUrl: node.href,
        })}
        data-legislation-status={node.withheld ? 'amended_not_held' : 'current'}
        className={
          node.withheld
            ? 'flex min-h-row items-center justify-between gap-4 rounded-md px-2 text-ink hover:bg-warning-soft'
            : 'flex min-h-row items-center justify-between gap-4 rounded-md px-2 text-ink hover:bg-hover'
        }
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-item tabular-nums">{node.label}</span>
          {node.heading ? (
            <span className="truncate text-meta text-muted">
              {node.heading}
            </span>
          ) : null}
        </span>
        {node.withheld ? (
          <StatusDot tone="warning">Amended wording withheld</StatusDot>
        ) : null}
      </Link>
    </li>
  )
}

export function LegislationActView({ identity }: { identity: string }) {
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
  const withheld = act.withheldCount > 0

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
          <StatusDot tone={withheld ? 'warning' : 'success'}>
            {withheld
              ? `${act.withheldCount} provisions not shown`
              : 'No unapplied amendments'}
          </StatusDot>
          <span aria-hidden>·</span>
          <span>Point-in-time date not recorded</span>
        </span>
      }
      actions={
        <>
          <a
            className={buttonClassName({ variant: 'secondary', size: 'md' })}
            href={act.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open original
            <ArrowUpRight aria-hidden size={14} />
          </a>
          <Link
            className={buttonClassName({ variant: 'ghost', size: 'md' })}
            to="/search"
          >
            Back to search
          </Link>
        </>
      }
    >
      <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHead title="Contents">
            <span className="text-meta text-subtle">
              {countLabel(act.totalCount)} in document order
            </span>
          </CardHead>
          <CardBody>
            {act.withheldCount > 0 ? (
              <div
                className="mb-4 rounded-md bg-warning-soft px-4 py-3"
                role="alert"
              >
                <p className="text-item text-warning">
                  {act.withheldCount} of {countLabel(act.totalCount)} are not
                  shown
                </p>
                <p className="mt-1 text-meta text-muted">
                  Those provisions are affected by amendments that have been
                  recorded but not yet applied, so their wording is withheld.
                  They stay listed below and link to the official revised text.
                </p>
              </div>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {act.contents.map((node) => (
                <ActContentsItem
                  key={node.labelPath}
                  node={node}
                  documentIdentity={act.identity}
                />
              ))}
            </ul>
          </CardBody>
        </Card>

        <aside aria-label="About this Act">
          <Card>
            <CardHead title="About this Act" />
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta">
                <dt className="text-subtle">Chapter</dt>
                <dd className="text-ink">{act.chapter}</dd>
                <dt className="text-subtle">Year</dt>
                <dd className="text-ink tabular-nums">{act.year}</dd>
                <dt className="text-subtle">Extent</dt>
                <dd className="text-ink">
                  {act.extent ? act.extent : 'Extent not recorded'}
                </dd>
                <dt className="text-subtle">Source</dt>
                <dd className="flex flex-col gap-1 text-ink">
                  <a
                    href={act.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {sourceName}
                  </a>
                  <span className="text-caption text-subtle">
                    {act.acquiredAt
                      ? `Retrieved ${formatDate(act.acquiredAt)}`
                      : 'Retrieval date not recorded'}
                  </span>
                  <a
                    href={act.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-caption text-ink underline-offset-2 hover:underline"
                  >
                    Open original
                  </a>
                </dd>
              </dl>
              <div className="mt-4 rounded-md bg-warning-soft px-4 py-3">
                <p className="text-caption text-warning">
                  Point-in-time date not recorded
                </p>
                <p className="mt-1 text-caption text-muted">
                  Check legislation.gov.uk before relying on the text. This page
                  shows the stored version, not a guarantee that later
                  amendments are incorporated.
                </p>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageScaffold>
  )
}
