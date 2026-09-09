import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmptyState } from '@obiter/ui'
import { apiUrl } from '../lib/api-url'

export interface LegislationProvisionDocument {
  id: string
  documentIdentity: string
  title: string
  year: number
  provisionLabel: string
  labelPath: string
  extent: string
  legislationStatus: 'current' | 'amended_not_held'
  text?: string
  officialUrl: string
  sourceUrl: string
  notice?: string
  canonicalUrl: string
}

export interface LegislationProvisionResponse {
  provision: LegislationProvisionDocument
}

export function legislationProvisionQueryOptions(provisionPath: string) {
  return queryOptions({
    queryKey: ['legislation-provision', provisionPath],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/search/legislation/${provisionPath}`),
      )
      if (response.status === 404) {
        throw new Error('Legislation provision was not found.')
      }
      if (!response.ok) {
        throw new Error('Legislation provision could not be loaded.')
      }
      return (await response.json()) as LegislationProvisionResponse
    },
  })
}

export function LegislationProvisionView({
  provisionPath,
}: {
  provisionPath: string
}) {
  const { data } = useSuspenseQuery(
    legislationProvisionQueryOptions(provisionPath),
  )
  const provision = data.provision
  const withheld = provision.legislationStatus === 'amended_not_held'

  return (
    <div className="mx-auto flex w-full max-w-[min(1500px,calc(100vw-420px))] flex-col gap-4">
      <section className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {provision.provisionLabel}
          </p>
          <h1 className="max-w-[860px] text-2xl font-semibold leading-tight text-ink">
            {provision.title}
          </h1>
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Year
              </dt>
              <dd className="text-sm font-medium text-ink">{provision.year}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Provision
              </dt>
              <dd className="text-sm font-medium text-ink">
                {provision.provisionLabel}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Extent
              </dt>
              <dd className="text-sm font-medium text-ink">
                {provision.extent || 'Extent not recorded'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-brand"
            href={provision.officialUrl}
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

      {withheld ? (
        <div
          className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-3"
          role="alert"
          data-legislation-status="amended_not_held"
        >
          <p className="text-sm font-semibold text-warning">
            Amended wording withheld
          </p>
          <p className="mt-1 text-sm text-muted">{provision.notice}</p>
          <a
            className="mt-2 inline-block text-sm font-semibold text-warning underline"
            href={provision.officialUrl}
            rel="noreferrer noopener"
          >
            Read the official revised provision
          </a>
        </div>
      ) : provision.text ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div
            className="mx-auto max-h-[calc(100dvh-270px)] w-[calc(100%-28px)] max-w-[1080px] overflow-auto rounded-lg border border-line-strong bg-raised p-8 text-ink shadow-lg md:p-10"
            role="document"
            aria-label={`${provision.provisionLabel} ${provision.title}`}
            data-legislation-status="current"
          >
            <p className="whitespace-pre-wrap text-[17px] leading-[1.85]">
              {provision.text}
            </p>
          </div>
        </section>
      ) : (
        <EmptyState
          title="No provision text"
          body="This Act match has no provision text. Add a section number to open a provision."
        />
      )}
    </div>
  )
}
