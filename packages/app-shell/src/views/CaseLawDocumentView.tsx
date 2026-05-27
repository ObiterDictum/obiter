import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '@ormont/ui'
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
      const response = await fetch(apiUrl(`/api/search/documents/${encodeURIComponent(caseId)}`))

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
    process.env.ORMONT_API_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
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
    <div className="shell-stack case-law-document">
      <section className="case-law-document__topbar">
        <div className="case-law-document__identity">
          <p>{formatNeutralCitation(data.neutralCitation)}</p>
          <h1>{data.title}</h1>
          <dl>
            <div>
              <dt>Court</dt>
              <dd>{courtLabel}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{dateLabel}</dd>
            </div>
          </dl>
        </div>
        <Link className="case-law-document__back" to="/search">
          Back
        </Link>
        <label className="case-law-document__search">
          <span>Search within case</span>
          <input
            value={caseQuery}
            onChange={(event) => setCaseQuery(event.target.value)}
            placeholder="Find text..."
            type="search"
          />
          {trimmedCaseQuery ? <em>{visibleParagraphs.length} matches</em> : null}
        </label>
      </section>

      <section className="case-law-document__viewer">
        {visibleParagraphs.length > 0 ? (
          <div className="case-law-result__page" role="document" aria-label={data.title}>
            <header className="case-law-result__page-header">
              <p>{data.court}</p>
              <h2>{data.title}</h2>
              <dl>
                <div>
                  <dt>Citation</dt>
                  <dd>{formatNeutralCitation(data.neutralCitation)}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{data.dateDecided}</dd>
                </div>
              </dl>
            </header>

            <div className="case-law-result__page-body">
              {visibleParagraphs.map((paragraph) => {
                const label = paragraphLabel(paragraph)
                const text = paragraphTextWithoutLabel(paragraph)

                return (
                  <p className="case-law-result__paragraph" key={paragraph.id}>
                    <span aria-label={label ? `Paragraph ${label}` : undefined}>
                      {label}
                    </span>
                    <span>
                      <HighlightedText text={text} query={trimmedCaseQuery} />
                    </span>
                  </p>
                )
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            title={trimmedCaseQuery ? 'No matches found' : 'Full text unavailable'}
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

function isDisplayJudgmentParagraph(paragraph: CaseLawParagraph, document: CaseLawDocument) {
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
  if ((citation && lower === citation) || lower.startsWith('neutral citation number')) return false
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
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}
