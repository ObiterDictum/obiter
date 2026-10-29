import { Link } from '@tanstack/react-router'
import { Scales } from '@phosphor-icons/react'
import { Card, CardBody, CardFoot, CardHead, StatusDot } from '@obiter/ui'
import { caseResultLocation } from '../../case-navigation'
import { formatDate } from '../../format'
import { provisionResultLocation } from '../../legislation-navigation'
import {
  JudgmentExtractProvenance,
  LegislationExtractProvenance,
} from './SearchSnippet'
import type { SearchResultRow } from './searchResultRows'
import { getReadableCourtLabel } from './searchTypes'

export function SearchPreview({
  row,
  embedded = false,
}: {
  row: SearchResultRow | undefined
  embedded?: boolean
}) {
  if (!row) {
    return (
      <Card aria-label="Result preview">
        {embedded ? null : <CardHead title="Preview" />}
        <CardBody className={embedded ? undefined : 'pt-6'}>
          <p className="text-meta text-muted">
            Select a result to see the source text and where it came from.
          </p>
        </CardBody>
      </Card>
    )
  }
  return row.kind === 'judgment' ? (
    <JudgmentPreview row={row} embedded={embedded} />
  ) : (
    <LegislationPreview row={row} embedded={embedded} />
  )
}

function JudgmentPreview({
  row,
  embedded,
}: {
  row: Extract<SearchResultRow, { kind: 'judgment' }>
  embedded: boolean
}) {
  const hit = row.hit
  const snippet = hit.snippets?.[0]
  return (
    <Card aria-label="Result preview">
      {embedded ? null : <CardHead title="Preview" />}
      <CardBody className="flex flex-col gap-4 pt-6">
        <p className="text-meta text-subtle">
          Judgment · {getReadableCourtLabel(hit.court)}
        </p>
        <h2 className="text-section leading-snug">
          <span className="italic">{hit.title}</span>
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-meta text-subtle">
          <span>{hit.neutralCitation ?? 'No neutral citation'}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDate(hit.dateDecided)}</span>
        </p>
        {snippet ? (
          <div className="rounded-md bg-fill p-4">
            <p className="flex items-center gap-1 text-caption text-subtle">
              <Scales aria-hidden size={12} /> Judgment extract
            </p>
            <p className="mt-1 text-meta leading-relaxed text-ink">
              {snippet.text}
            </p>
            <JudgmentExtractProvenance hit={hit} snippet={snippet} />
          </div>
        ) : (
          <p className="text-meta text-muted">
            No extracted text for this result. Open the judgment to read the
            source.
          </p>
        )}
        <p className="text-caption text-subtle">
          Extracted from the judgment, not an Obiter summary.
        </p>
      </CardBody>
      <CardFoot>
        <Link
          {...caseResultLocation(hit)}
          className="text-meta text-ink underline-offset-2 hover:underline"
        >
          Open judgment
        </Link>
        <a
          href={hit.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-meta text-ink underline-offset-2 hover:underline"
        >
          Open original
        </a>
      </CardFoot>
    </Card>
  )
}

function LegislationPreview({
  row,
  embedded,
}: {
  row: Extract<SearchResultRow, { kind: 'legislation' }>
  embedded: boolean
}) {
  const hit = row.hit
  const withheld = hit.legislationStatus === 'amended_not_held'
  const extract = hit.snippets?.[0]?.text ?? hit.text
  return (
    <Card aria-label="Result preview">
      {embedded ? null : <CardHead title="Preview" />}
      <CardBody className="flex flex-col gap-4 pt-6">
        <p className="text-meta text-subtle">
          Legislation · legislation.gov.uk
        </p>
        <h2 className="text-section leading-snug">
          {hit.provisionLabel} · {hit.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-meta text-subtle">
          <span>{hit.extent ? hit.extent : 'Extent not recorded'}</span>
          <span aria-hidden>·</span>
          <StatusDot tone={withheld ? 'warning' : 'success'}>
            {withheld ? 'Amended wording withheld' : 'No unapplied amendments'}
          </StatusDot>
        </div>
        {withheld ? (
          <div className="rounded-md bg-warning-soft p-4 text-meta text-ink">
            {hit.notice}
          </div>
        ) : extract ? (
          <div className="rounded-md bg-fill p-4">
            <p className="flex items-center gap-1 text-caption text-subtle">
              <Scales aria-hidden size={12} /> Legislation extract
            </p>
            <p className="mt-1 text-meta leading-relaxed text-ink">{extract}</p>
            <LegislationExtractProvenance hit={hit} />
          </div>
        ) : (
          <p className="text-meta text-muted">
            No extracted provision text for this result.
          </p>
        )}
        <p className="text-caption text-subtle">
          Point-in-time date not recorded. Check legislation.gov.uk before
          relying on the text.
        </p>
      </CardBody>
      <CardFoot>
        <Link
          {...provisionResultLocation(hit)}
          className="text-meta text-ink underline-offset-2 hover:underline"
        >
          Open provision
        </Link>
        <a
          href={hit.officialUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-meta text-ink underline-offset-2 hover:underline"
        >
          legislation.gov.uk
        </a>
      </CardFoot>
    </Card>
  )
}
