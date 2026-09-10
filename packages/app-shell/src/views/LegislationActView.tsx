import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { WarningCircle } from '@phosphor-icons/react'
import { Badge } from '@obiter/ui'
import { apiUrl } from '../lib/api-url'
import { provisionResultLocation } from '../legislation-navigation'

export type LegislationActContentsKind =
  | 'part'
  | 'chapter'
  | 'schedule'
  | 'crossheading'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'

export interface LegislationActContentsNode {
  label: string
  labelPath: string
  href: string
  extent: string
  withheld: boolean
  kind: LegislationActContentsKind
  /** Heading text for container rows; never set for provision rows. */
  text?: string
  children: LegislationActContentsNode[]
}

export interface LegislationActDocument {
  identity: string
  title: string
  year: number
  number: number
  chapter: string
  extent: string
  officialUrl: string
  sourceUrl: string
  canonicalUrl: string
  /** Content rows only: sections plus schedule paragraphs. Containers
   * (Part, Chapter, Schedule, crossheading) are headings, never withheld,
   * and excluded from both counts. */
  totalCount: number
  withheldCount: number
  contents: LegislationActContentsNode[]
}

export interface LegislationActResponse {
  act: LegislationActDocument
}

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
  // Container rows (Part, Chapter, Schedule, crossheading) render as
  // headings with their children nested beneath; provision rows are links
  // to their provision pages. Indentation comes from the tree itself,
  // never from label-path depth.
  if (isContainerKind(node.kind)) {
    return (
      <li>
        <div className="flex flex-col gap-0.5 py-1.5 pl-3">
          <span className="text-sm font-bold text-ink">{node.label}</span>
          {node.text && node.text !== node.label ? (
            <span className="text-sm text-muted">{node.text}</span>
          ) : null}
        </div>
        {node.children.length > 0 ? (
          <ul className="ml-3 flex flex-col gap-1 border-l border-line/60 pl-2">
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
            ? 'group flex items-start justify-between gap-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-ink transition-colors hover:bg-warning/15'
            : 'group flex items-start justify-between gap-4 rounded-md px-3 py-2.5 text-ink transition-colors hover:bg-raised'
        }
      >
        <span className="block min-w-0 flex-1">
          <strong className="block text-sm font-medium leading-snug">
            {node.label}
          </strong>
          {node.withheld ? (
            <span className="mt-1.5 block">
              <Badge tone="warning">
                <WarningCircle size={13} aria-hidden />
                Amended wording withheld
              </Badge>
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

export function legislationActQueryOptions(identity: string) {
  return queryOptions({
    queryKey: ['legislation-act', identity],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      // Encode per segment so identity slashes stay as separators while
      // unsafe characters inside a segment cannot break the request path.
      const encodedIdentity = identity
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const response = await fetch(
        apiUrl(`/api/search/legislation/${encodedIdentity}`),
      )
      if (response.status === 404) {
        throw new Error('Legislation Act was not found.')
      }
      if (!response.ok) {
        throw new Error('Legislation Act could not be loaded.')
      }
      return (await response.json()) as LegislationActResponse
    },
  })
}

export function LegislationActView({ identity }: { identity: string }) {
  const { data } = useSuspenseQuery(legislationActQueryOptions(identity))
  const act = data.act

  return (
    <div className="mx-auto flex w-full max-w-[min(1500px,calc(100vw-420px))] flex-col gap-4">
      <section className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {act.chapter}
          </p>
          <h1 className="max-w-[860px] text-2xl font-semibold leading-tight text-ink">
            {act.title}
          </h1>
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Year
              </dt>
              <dd className="text-sm font-medium text-ink">{act.year}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Chapter
              </dt>
              <dd className="text-sm font-medium text-ink">{act.chapter}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Extent
              </dt>
              <dd className="text-sm font-medium text-ink">
                {act.extent || 'Extent not recorded'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-brand"
            href={act.officialUrl}
            rel="noreferrer noopener"
          >
            Official text
          </a>
          <Link
            className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-brand"
            to="/search"
          >
            Back
          </Link>
        </div>
      </section>

      {act.withheldCount > 0 ? (
        <div
          className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-warning">
            {act.withheldCount} of {countLabel(act.totalCount)} are not shown
          </p>
          <p className="mt-1 text-sm text-muted">
            Those provisions are affected by amendments that have been recorded
            but not yet applied, so their wording is withheld. They stay listed
            below and link to the official revised text.
          </p>
        </div>
      ) : null}

      <section aria-label={`${act.title} contents`}>
        <h2 className="pb-2 text-[11px] font-medium tracking-wide text-muted">
          Contents · {countLabel(act.totalCount)} in document order
        </h2>
        <ul className="flex flex-col gap-0.5">
          {act.contents.map((node) => (
            <ActContentsItem
              key={node.labelPath}
              node={node}
              documentIdentity={act.identity}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
