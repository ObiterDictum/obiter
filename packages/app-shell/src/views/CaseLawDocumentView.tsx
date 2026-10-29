import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, MagnifyingGlass } from '@phosphor-icons/react'
import {
  Button,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Input,
  Skeleton,
  buttonClassName,
} from '@obiter/ui'
import { useState } from 'react'
import { ContentFrame } from '../content-frame'
import { PageScaffold } from '../page-scaffold'
import { formatDate } from '../format'
import { selectJudgmentParagraphs } from '../legal-search-selection'
import { getReadableCourtLabel } from '../components/search/searchTypes'
import {
  findCaseLawUrlForDocumentId,
  sourceNameForUrl,
} from '../components/search/provenance'
import { SourceActions } from '../components/sources/SourceActions'
import {
  caseLawDocumentQueryOptions,
  type CaseLawDocument,
  type CaseLawParagraph,
} from './case-law-document-query'

// Kept on this module's surface for importers that expect the view and its
// query together; the query itself is owned by case-law-document-query.
export { caseLawDocumentQueryOptions }
export type { CaseLawDocumentResponse } from './case-law-document-query'

export function CaseLawDocumentView({ caseId }: { caseId: string }) {
  const [caseQuery, setCaseQuery] = useState('')
  const query = useQuery(caseLawDocumentQueryOptions(caseId))

  if (query.isPending) {
    return (
      <ContentFrame className="flex flex-col gap-6 py-14" aria-busy="true">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-96" />
        <span className="sr-only">Loading the judgment…</span>
      </ContentFrame>
    )
  }

  if (query.isError) {
    const originalUrl = findCaseLawUrlForDocumentId(caseId)
    return (
      <ContentFrame className="flex flex-col items-start gap-4 py-14">
        <div>
          <p className="mb-1 text-meta text-subtle">Case law · Judgment</p>
          <h1 className="text-page text-ink">Judgment could not be loaded</h1>
          <p className="mt-2 max-w-[68ch] text-body text-muted">
            The source did not answer. It may be temporarily unavailable, or the
            stored record may be incomplete. Nothing has been guessed in its
            place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
          {originalUrl ? (
            <a
              className={buttonClassName({ variant: 'ghost', size: 'md' })}
              href={originalUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open original on The National Archives
              <ArrowUpRight aria-hidden size={14} />
            </a>
          ) : null}
        </div>
      </ContentFrame>
    )
  }

  const response = query.data
  const data = response.document
  const withdrawn = response.withdrawn
  const showParagraphNumbers = response.courtParagraphNumbers === true
  const paragraphs = selectJudgmentParagraphs(data).filter((paragraph) =>
    isDisplayJudgmentParagraph(paragraph, data),
  )
  const trimmedCaseQuery = caseQuery.trim()
  const visibleParagraphs = trimmedCaseQuery
    ? paragraphs.filter((paragraph) =>
        paragraph.text.toLowerCase().includes(trimmedCaseQuery.toLowerCase()),
      )
    : paragraphs
  // A heading the court numbered can repeat a paragraph's number. The first
  // holder in the whole judgment keeps the anchor, so ids stay unique and a
  // deep link lands on the same paragraph whether or not a search is active.
  const anchorOwners = new Map<number, string>()
  for (const paragraph of paragraphs) {
    if (!anchorOwners.has(paragraph.paragraphNumber))
      anchorOwners.set(paragraph.paragraphNumber, paragraph.id)
  }
  const courtLabel = getReadableCourtLabel(data.court)
  const sourceName = sourceNameForUrl(data.sourceUrl)

  return (
    <PageScaffold
      eyebrow={`${courtLabel} · Judgment`}
      title={<em>{data.title}</em>}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{formatNeutralCitation(data.neutralCitation)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDate(data.dateDecided)}</span>
        </span>
      }
      actions={
        <>
          <SourceActions
            source={{
              kind: 'judgment',
              sourceId: data.id,
              title: data.title,
              citation: data.neutralCitation,
              sourceUrl: data.sourceUrl,
            }}
          />
          <a
            className={buttonClassName({ variant: 'secondary', size: 'md' })}
            href={data.sourceUrl}
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
      {withdrawn ? (
        <div className="rounded-lg bg-danger-soft px-6 py-4" role="alert">
          <p className="text-item text-danger">
            Withdrawn upstream
            {withdrawn.withdrawnAt
              ? ` on ${formatDate(withdrawn.withdrawnAt)}`
              : ''}
          </p>
          <p className="mt-1 text-meta text-muted">{withdrawn.message}</p>
          <a
            className="mt-2 inline-block text-meta text-ink underline"
            href={withdrawn.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            View the official judgment page
          </a>
        </div>
      ) : null}

      <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2">
              <MagnifyingGlass aria-hidden size={14} className="text-subtle" />
              <Input
                aria-label="Search within case"
                type="search"
                name="case-search"
                placeholder="Find text…"
                value={caseQuery}
                onChange={(event) => setCaseQuery(event.target.value)}
                className="w-56"
              />
            </div>
            {trimmedCaseQuery ? (
              <span className="text-meta text-muted tabular-nums">
                {visibleParagraphs.length}{' '}
                {visibleParagraphs.length === 1 ? 'match' : 'matches'}
              </span>
            ) : null}
          </div>

          {visibleParagraphs.length > 0 ? (
            <article
              role="document"
              aria-label={data.title}
              className="rounded-lg bg-paper px-8 py-10 font-serif text-paper-ink shadow-md md:px-12"
            >
              <div className="flex flex-col gap-2">
                {visibleParagraphs.map((paragraph) => {
                  const label = showParagraphNumbers
                    ? String(paragraph.paragraphNumber)
                    : ''
                  const anchor =
                    label &&
                    anchorOwners.get(paragraph.paragraphNumber) === paragraph.id
                      ? `para-${label}`
                      : undefined

                  return (
                    <p
                      className="grid scroll-mt-6 grid-cols-[34px_minmax(0,1fr)] gap-3 text-[16px] leading-[1.8]"
                      id={anchor}
                      key={paragraph.id}
                    >
                      <span
                        aria-label={label ? `Paragraph ${label}` : undefined}
                        className="pt-1 text-right font-sans text-meta text-paper-muted tabular-nums"
                      >
                        {label}
                      </span>
                      <span>
                        <HighlightedText
                          text={paragraph.text.trim()}
                          query={trimmedCaseQuery}
                        />
                      </span>
                    </p>
                  )
                })}
              </div>
            </article>
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

        <aside aria-label="Judgment details" className="flex flex-col gap-6">
          <Card>
            <CardHead title="Case details" />
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta">
                <dt className="text-subtle">Court</dt>
                <dd className="text-ink">{courtLabel}</dd>
                <dt className="text-subtle">Date</dt>
                <dd className="text-ink tabular-nums">
                  {formatDate(data.dateDecided)}
                </dd>
                <dt className="text-subtle">Citation</dt>
                <dd className="text-ink">
                  {formatNeutralCitation(data.neutralCitation)}
                </dd>
                <dt className="text-subtle">Source</dt>
                <dd className="flex flex-col gap-1 text-ink">
                  <a
                    href={data.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {sourceName}
                  </a>
                  <span className="text-caption text-subtle">
                    {response.acquiredAt
                      ? `Retrieved ${formatDate(response.acquiredAt)}`
                      : 'Retrieval date not recorded'}
                  </span>
                  <a
                    href={data.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-caption text-ink underline-offset-2 hover:underline"
                  >
                    Open original
                  </a>
                </dd>
              </dl>
            </CardBody>
          </Card>

          <p className="text-caption text-subtle">
            The text is the stored source. Paragraph numbers and anchors are the
            court’s own where the record carries them; no judge, party or
            pinpoint is inferred when the source omits it.
          </p>
        </aside>
      </div>
    </PageScaffold>
  )
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

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text

  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-brand-soft px-0.5 text-paper-ink">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}
