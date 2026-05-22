import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '@ormont/ui'
import { selectJudgmentParagraphs } from './AtlasSearchView'

interface AtlasParagraph {
  id: string
  paragraphNumber: number
  text: string
}

interface AtlasDocument {
  id: string
  title: string
  neutralCitation: string
  court: string
  dateDecided: string
  sourceUrl: string
  paragraphs?: AtlasParagraph[]
}

interface AtlasDocumentResponse {
  document: AtlasDocument
}

export function atlasDocumentQueryOptions(caseId: string) {
  return queryOptions({
    queryKey: ['atlas-document', caseId],
    queryFn: async () => {
      const response = await fetch(apiUrl(`/api/search/documents/${encodeURIComponent(caseId)}`))

      if (!response.ok) {
        throw new Error('Atlas document was not found.')
      }

      return ((await response.json()) as AtlasDocumentResponse).document
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

export function AtlasCaseView({ caseId }: { caseId: string }) {
  const [caseQuery, setCaseQuery] = useState('')
  const { data } = useSuspenseQuery(atlasDocumentQueryOptions(caseId))
  const paragraphs = selectJudgmentParagraphs(data).filter((paragraph) =>
    isDisplayJudgmentParagraph(paragraph, data),
  )
  const trimmedCaseQuery = caseQuery.trim()
  const visibleParagraphs = trimmedCaseQuery
    ? paragraphs.filter((paragraph) =>
        paragraph.text.toLowerCase().includes(trimmedCaseQuery.toLowerCase()),
      )
    : paragraphs

  return (
    <div className="shell-stack atlas-case">
      <section className="atlas-case__topbar">
        <div className="atlas-case__identity">
          <p>Case law</p>
          <h1>{data.title}</h1>
          <dl>
            <div>
              <dt>Citation</dt>
              <dd>{data.neutralCitation}</dd>
            </div>
            <div>
              <dt>Court</dt>
              <dd>{data.court}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{data.dateDecided}</dd>
            </div>
          </dl>
          <label className="atlas-case__search">
            <span>Search within case</span>
            <input
              value={caseQuery}
              onChange={(event) => setCaseQuery(event.target.value)}
              placeholder="jurisdiction, evidence, order..."
              type="search"
            />
            {trimmedCaseQuery ? <em>{visibleParagraphs.length} matches</em> : null}
          </label>
        </div>
        <Link className="atlas-case__back" to="/search">
          Back to search
        </Link>
      </section>

      <section className="atlas-case__viewer">
        {visibleParagraphs.length > 0 ? (
          <div className="atlas-result__page" role="document" aria-label={data.title}>
            <header className="atlas-result__page-header">
              <p>{data.court}</p>
              <h2>{data.title}</h2>
              <dl>
                <div>
                  <dt>Citation</dt>
                  <dd>{data.neutralCitation}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{data.dateDecided}</dd>
                </div>
              </dl>
            </header>

            <div className="atlas-result__page-body">
              {visibleParagraphs.map((paragraph) => {
                const label = paragraphLabel(paragraph)
                const text = paragraphTextWithoutLabel(paragraph)

                return (
                  <p className="atlas-result__paragraph" key={paragraph.id}>
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
            title="Stored text unavailable"
            body="Atlas has cached the authority metadata, but no paragraph text is stored for this case yet."
          />
        )}
      </section>
    </div>
  )
}

function isDisplayJudgmentParagraph(paragraph: AtlasParagraph, document: AtlasDocument) {
  const text = paragraph.text.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const title = document.title.toLowerCase()
  const citation = document.neutralCitation.toLowerCase()
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
  if (lower === citation || lower.startsWith('neutral citation number')) return false
  if (lower.length < 8) return false

  return true
}

function paragraphLabel(paragraph: AtlasParagraph) {
  return paragraph.text.trim().match(/^(\d+)\.\s+/)?.[1] ?? ''
}

function paragraphTextWithoutLabel(paragraph: AtlasParagraph) {
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
