import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '@obiter/ui'
import { selectJudgmentParagraphs } from './LegalSearchView'
import { getCourtLabel } from '../components/search'

interface CaseLawParagraph {
  id: string
  paragraphNumber: number
  text: string
}

interface CaseLawDocument {
  id: string
  title: string
  neutralCitation: string | null
  court: string
  dateDecided: string
  sourceUrl: string
  paragraphs?: CaseLawParagraph[]
}

interface CaseLawDocumentResponse {
  document: CaseLawDocument
}

export function caseLawDocumentQueryOptions(caseId: string) {
  return queryOptions({
    queryKey: ['case-law-document', caseId],
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/search/documents/${encodeURIComponent(caseId)}`),
      )

      if (!response.ok) {
        throw new Error('Case law document was not found.')
      }

      return ((await response.json()) as CaseLawDocumentResponse).document
    },
  })
}

function apiUrl(path: string) {
  if (typeof window !== 'undefined') {
    return path
  }

  return new URL(
    path,
    process.env.OBITER_API_ORIGIN ??
      process.env.BETTER_AUTH_URL ??
      'http://localhost:8787',
  ).toString()
}

export function CaseLawDocumentView({ caseId }: { caseId: string }) {
  const [caseQuery, setCaseQuery] = useState('')
  const { data } = useSuspenseQuery(caseLawDocumentQueryOptions(caseId))
  const paragraphs = selectJudgmentParagraphs(data).filter((paragraph) =>
    isDisplayJudgmentParagraph(paragraph, data),
  )
  const trimmedCaseQuery = caseQuery.trim()
  const visibleParagraphs = trimmedCaseQuery
    ? paragraphs.filter((paragraph) =>
        paragraph.text.toLowerCase().includes(trimmedCaseQuery.toLowerCase()),
      )
    : paragraphs
  const courtLabel = getReadableCourtLabel(data.court)
  const dateLabel = formatCaseDate(data.dateDecided)

  return (
    <div className="mx-auto flex w-full max-w-[min(1500px,calc(100vw-420px))] flex-col gap-4">
      <section className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {formatNeutralCitation(data.neutralCitation)}
          </p>
          <h1 className="max-w-[860px] text-2xl font-semibold leading-tight text-ink">
            {data.title}
          </h1>
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Court
              </dt>
              <dd className="text-sm font-medium text-ink">{courtLabel}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Date
              </dt>
              <dd className="text-sm font-medium text-ink">{dateLabel}</dd>
            </div>
          </dl>
        </div>
        <Link
          className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-brand"
          to="/search"
        >
          Back
        </Link>
        <label className="flex items-center gap-2 md:col-start-1 md:col-end-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Search within case
          </span>
          <input
            className="min-h-[28px] min-w-0 max-w-[320px] flex-1 rounded-md border border-line bg-canvas px-2.5 text-xs text-ink outline-none placeholder:text-subtle focus:border-brand"
            value={caseQuery}
            onChange={(event) => setCaseQuery(event.target.value)}
            placeholder="Find text..."
            type="search"
          />
          {trimmedCaseQuery ? (
            <em className="text-xs font-semibold not-italic text-brand">
              {visibleParagraphs.length} matches
            </em>
          ) : null}
        </label>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        {visibleParagraphs.length > 0 ? (
          <div
            className="mx-auto max-h-[calc(100dvh-270px)] w-[calc(100%-28px)] max-w-[1080px] overflow-auto rounded-lg border border-line-strong bg-raised p-8 text-ink shadow-lg md:p-10"
            role="document"
            aria-label={data.title}
          >
            <header className="mb-6 border-b border-line pb-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                {data.court}
              </p>
              <h2 className="mx-auto mt-2.5 max-w-[760px] text-2xl font-semibold leading-snug text-ink">
                {data.title}
              </h2>
              <dl className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    Citation
                  </dt>
                  <dd className="text-sm text-ink">
                    {formatNeutralCitation(data.neutralCitation)}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    Date
                  </dt>
                  <dd className="text-sm text-ink">{data.dateDecided}</dd>
                </div>
              </dl>
            </header>

            <div className="flex flex-col gap-3">
              {visibleParagraphs.map((paragraph) => {
                const label = paragraphLabel(paragraph)
                const text = paragraphTextWithoutLabel(paragraph)

                return (
                  <p
                    className="grid grid-cols-[42px_minmax(0,1fr)] gap-4 leading-relaxed text-ink"
                    key={paragraph.id}
                  >
                    <span
                      aria-label={label ? `Paragraph ${label}` : undefined}
                      className="pt-0.5 text-right text-xs font-semibold text-subtle"
                    >
                      {label}
                    </span>
                    <span className="text-base">
                      <HighlightedText text={text} query={trimmedCaseQuery} />
                    </span>
                  </p>
                )
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            title={
              trimmedCaseQuery ? 'No matches found' : 'Full text unavailable'
            }
            body={
              trimmedCaseQuery
                ? `No paragraphs match "${trimmedCaseQuery}".`
                : 'The authority metadata is cached, but no paragraph text is stored for this case yet.'
            }
          />
        )}
      </section>
    </div>
  )
}

function getReadableCourtLabel(court: string) {
  const normalized = court.replace(/-/g, '/')
  const direct = getCourtLabel(normalized)

  if (direct !== normalized) return direct

  return court
    .split(/[-/]/)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(' ')
}

function formatCaseDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatNeutralCitation(neutralCitation: string | null) {
  return neutralCitation ?? 'No neutral citation'
}

function isDisplayJudgmentParagraph(
  paragraph: CaseLawParagraph,
  document: CaseLawDocument,
) {
  const text = paragraph.text.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const title = document.title.toLowerCase()
  const citation = document.neutralCitation?.toLowerCase() ?? ''
  const excluded = [
    'we place some essential cookies',
    'additional cookies',
    'this information will help us make improvements',
    'access official court judgments',
    'skip to main content',
    'open justice licence',
  ]

  if (excluded.some((phrase) => lower.includes(phrase))) return false
  if (lower === title || lower === `${title} -`) return false
  if (
    (citation && lower === citation) ||
    lower.startsWith('neutral citation number')
  )
    return false
  if (lower.length < 8) return false

  return true
}

function paragraphLabel(paragraph: CaseLawParagraph) {
  return paragraph.text.trim().match(/^(\d+)\.\s+/)?.[1] ?? ''
}

function paragraphTextWithoutLabel(paragraph: CaseLawParagraph) {
  return paragraph.text.trim().replace(/^\d+\.\s+/, '')
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text

  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-brand/30 px-0.5 text-ink">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}
