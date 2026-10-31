import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Button,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Skeleton,
  StatusDot,
  buttonClassName,
} from '@obiter/ui'
import { ArrowUpRight } from '@obiter/ui/icons'
import { ContentFrame } from '../content-frame'
import { PageScaffold } from '../page-scaffold'
import { sourceNameForUrl } from '../components/search/provenance'
import { SourceActions } from '../components/sources/SourceActions'
import { formatDate } from '../format'
import { provisionResultLocation } from '../legislation-navigation'
import {
  legislationProvisionQueryOptions,
  type LegislationProvisionSubsection,
} from './legislation-document-query'

export { legislationProvisionQueryOptions }
export type { LegislationProvisionResponse } from './legislation-document-query'

export function LegislationProvisionView({
  provisionPath,
}: {
  provisionPath: string
}) {
  const query = useQuery(legislationProvisionQueryOptions(provisionPath))

  if (query.isPending) {
    return (
      <ContentFrame className="flex flex-col gap-6 py-14" aria-busy="true">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-96" />
        <span className="sr-only">Loading the provision…</span>
      </ContentFrame>
    )
  }

  if (query.isError) {
    return (
      <ContentFrame className="flex flex-col items-start gap-4 py-14">
        <div>
          <p className="mb-1 text-meta text-subtle">UK Public General Acts</p>
          <h1 className="text-page text-ink">Provision could not be loaded</h1>
          <p className="mt-2 max-w-[68ch] text-body text-muted">
            legislation.gov.uk or the stored provision did not answer. The text
            has not been guessed or substituted.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </ContentFrame>
    )
  }

  const provision = query.data.provision
  const withheld = provision.legislationStatus === 'amended_not_held'
  const sourceName = sourceNameForUrl(provision.sourceUrl)

  return (
    <PageScaffold
      eyebrow="UK Public General Acts"
      title={`${provision.provisionLabel} · ${provision.title}`}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {provision.extent ? provision.extent : 'Extent not recorded'}
          </span>
          <span aria-hidden>·</span>
          <StatusDot tone={withheld ? 'warning' : 'success'}>
            {withheld ? 'Amended wording withheld' : 'No unapplied amendments'}
          </StatusDot>
          <span aria-hidden>·</span>
          <span>Point-in-time date not recorded</span>
        </span>
      }
      actions={
        <>
          <SourceActions
            source={{
              kind: 'legislation',
              sourceId: `${provision.documentIdentity}/${provision.labelPath}`,
              title: provision.title,
              citation: provision.provisionLabel,
              sourceUrl: provision.officialUrl,
            }}
          />
          <a
            className={buttonClassName({ variant: 'secondary', size: 'md' })}
            href={provision.officialUrl}
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
        <section className="flex min-w-0 flex-col gap-4">
          {withheld ? (
            <div
              className="rounded-lg bg-warning-soft px-6 py-4"
              role="alert"
              data-legislation-status="amended_not_held"
            >
              <p className="text-item text-warning">Amended wording withheld</p>
              <p className="mt-1 text-meta text-muted">{provision.notice}</p>
              <a
                className="mt-2 inline-block text-meta text-ink underline"
                href={provision.officialUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Read the official revised provision
              </a>
            </div>
          ) : provision.text || provision.subsections ? (
            <article
              role="document"
              aria-label={[
                provision.provisionLabel,
                provision.heading,
                provision.title,
              ]
                .filter(Boolean)
                .join(' ')}
              data-legislation-status="current"
              className="rounded-lg bg-paper px-8 py-10 font-serif text-paper-ink shadow-md md:px-12"
            >
              {provision.heading ? (
                <h2 className="mb-4 font-serif text-section text-paper-ink">
                  {provision.heading}
                </h2>
              ) : null}
              {provision.text ? (
                <p className="whitespace-pre-wrap text-[16px] leading-[1.85]">
                  {provision.text}
                </p>
              ) : null}
              {provision.subsections ? (
                <div className="mt-2 flex flex-col">
                  {provision.subsections.map((subsection) => (
                    <SubsectionNode
                      key={subsection.labelPath}
                      node={subsection}
                      documentIdentity={provision.documentIdentity}
                      parentLabel={provision.provisionLabel}
                      depth={0}
                    />
                  ))}
                </div>
              ) : null}
            </article>
          ) : (
            <EmptyState
              title="No provision text"
              body="This Act match has no provision text. Add a section number to open a provision."
            />
          )}
          <p className="text-caption text-subtle">
            {provision.title}, {provision.provisionLabel} · source: {sourceName}{' '}
            · point-in-time date not recorded.
          </p>
        </section>

        <aside aria-label="Provision details">
          <Card>
            <CardHead title="Provision details" />
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta">
                <dt className="text-subtle">Act</dt>
                <dd className="text-ink">{provision.title}</dd>
                <dt className="text-subtle">Provision</dt>
                <dd className="text-ink">{provision.provisionLabel}</dd>
                <dt className="text-subtle">Extent</dt>
                <dd className="text-ink">
                  {provision.extent ? provision.extent : 'Extent not recorded'}
                </dd>
                <dt className="text-subtle">Status</dt>
                <dd className="text-ink">
                  <StatusDot
                    tone={withheld ? 'warning' : 'success'}
                    className="whitespace-nowrap"
                  >
                    {withheld
                      ? 'Amended wording withheld'
                      : 'No unapplied amendments'}
                  </StatusDot>
                </dd>
                <dt className="text-subtle">Source</dt>
                <dd className="flex flex-col gap-1 text-ink">
                  <a
                    href={provision.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {sourceName}
                  </a>
                  <span className="text-caption text-subtle">
                    {provision.acquiredAt
                      ? `Retrieved ${formatDate(provision.acquiredAt)}`
                      : 'Retrieval date not recorded'}
                  </span>
                  <a
                    href={provision.officialUrl}
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

function SubsectionNode({
  node,
  documentIdentity,
  parentLabel,
  depth,
}: {
  node: LegislationProvisionSubsection
  documentIdentity: string
  parentLabel: string
  depth: number
}) {
  const label = node.label.startsWith(parentLabel)
    ? node.label.slice(parentLabel.length).trim()
    : node.label
  const withheld = node.legislationStatus === 'amended_not_held'
  return (
    <div className={depth > 0 ? 'ml-6 border-l border-line pl-4' : undefined}>
      <p className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 py-1 text-[16px] leading-[1.85]">
        <Link
          {...provisionResultLocation({
            documentIdentity,
            labelPath: node.labelPath,
            canonicalUrl: node.href,
          })}
          aria-label={`${node.label} of this provision`}
          title={node.label}
          className="pt-0.5 text-right font-sans text-meta text-paper-muted tabular-nums underline-offset-2 hover:underline"
        >
          {label}
        </Link>
        {withheld ? (
          <span className="text-meta text-paper-muted">
            Wording withheld: amendments are recorded but not applied.{' '}
            <a
              className="text-paper-ink underline"
              href={node.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              Read the official revised provision
            </a>
          </span>
        ) : (
          <span className="whitespace-pre-wrap">
            {node.text ?? 'No stored wording for this level.'}
          </span>
        )}
      </p>
      {node.children.map((child) => (
        <SubsectionNode
          key={child.labelPath}
          node={child}
          documentIdentity={documentIdentity}
          parentLabel={node.label}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}
