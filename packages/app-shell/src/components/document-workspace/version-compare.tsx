import { useState } from 'react'
import { ArrowsLeftRight } from '@phosphor-icons/react'
import { Button, Select } from '@obiter/ui'
import type {
  DocumentCompareResponse,
  DocumentComparisonEntry,
} from '@obiter/contracts'
import { DOCUMENT_COMPARISON_ENTRY_MAX_COUNT } from '@obiter/contracts'
import { useDocumentCompare } from '../../document-workspace-api'
import { formatDate } from '../../format'
import type { DocumentVersionRecord } from '../../documents'
import { LoadingBlock, QueryError } from './workspace-chrome'

/**
 * The Compare versions control: two stored versions in, the structured
 * difference out. Only ready DOCX versions are offered — the comparison
 * parses document models, and the API refuses a pair containing anything
 * else. The fetch fires on Compare, not on selection, so browsing the
 * pickers never issues a request.
 */
export function DocumentVersionCompare({
  documentId,
  versions,
}: {
  documentId: string
  versions: DocumentVersionRecord[]
}) {
  const comparable = versions.filter(
    (version) =>
      version.documentStatus === 'ready' && version.fileType === 'docx',
  )
  const [baseId, setBaseId] = useState<string | undefined>()
  const [targetId, setTargetId] = useState<string | undefined>()
  const [pair, setPair] = useState<{
    baseVersionId: string
    targetVersionId: string
  } | null>(null)

  if (comparable.length < 2) return null

  // Versions arrive newest-first; the default pair is the previous version
  // against the current one — the question "what just changed" asks.
  const resolvedBase = baseId ?? comparable[1]?.id
  const resolvedTarget = targetId ?? comparable[0]?.id
  // The panel belongs to one document, so the label names the version and its
  // date rather than repeating the filename the header already shows.
  const options = comparable.map((version) => ({
    value: version.id,
    label: `Version ${String(version.versionNumber)} · ${formatDate(version.createdAt)}`,
  }))

  const base = comparable.find((version) => version.id === resolvedBase)
  const target = comparable.find((version) => version.id === resolvedTarget)
  return (
    <div
      className="flex flex-col gap-3 border-t border-line pt-3"
      aria-label="Compare versions"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-item text-ink">Compare versions</h3>
          {/* The direction is stated in words: a diff read the wrong way round
              inverts every decision made from it. */}
          <p className="text-caption text-muted">
            {base && target
              ? `Changes from version ${String(base.versionNumber)} to version ${String(target.versionNumber)}`
              : 'Choose a base version and a version to compare it with.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Swap base and comparison"
          onClick={() => {
            setBaseId(resolvedTarget)
            setTargetId(resolvedBase)
            // The comparison on screen answers the old direction; drop it
            // rather than leave it under a heading that now says otherwise.
            setPair(null)
          }}
          iconStart={<ArrowsLeftRight size={12} aria-hidden />}
        >
          Swap
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Base"
          options={options}
          value={resolvedBase}
          onValueChange={(value) => setBaseId(value ?? undefined)}
          className="min-w-48"
        />
        <Select
          label="Compare to"
          options={options}
          value={resolvedTarget}
          onValueChange={(value) => setTargetId(value ?? undefined)}
          className="min-w-48"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (resolvedBase && resolvedTarget) {
              setPair({
                baseVersionId: resolvedBase,
                targetVersionId: resolvedTarget,
              })
            }
          }}
        >
          Compare
        </Button>
      </div>
      {pair ? (
        <ComparisonResult
          documentId={documentId}
          baseVersionId={pair.baseVersionId}
          targetVersionId={pair.targetVersionId}
        />
      ) : null}
    </div>
  )
}

function ComparisonResult({
  documentId,
  baseVersionId,
  targetVersionId,
}: {
  documentId: string
  baseVersionId: string
  targetVersionId: string
}) {
  const compare = useDocumentCompare(documentId, baseVersionId, targetVersionId)

  if (compare.isLoading) return <LoadingBlock label="Comparing versions" />
  if (compare.isError) {
    return (
      <QueryError
        error={compare.error}
        fallback="The versions could not be compared."
      />
    )
  }
  const data = compare.data
  if (!data) return null
  return <DocumentComparisonResult data={data} />
}

/** The comparison payload painted — separated from the fetch so tests can
 * exercise the rendering without a query client or network. */
export function DocumentComparisonResult({
  data,
}: {
  data: DocumentCompareResponse
}) {
  return (
    <div className="flex flex-col gap-2" data-version-comparison>
      <p className="text-caption text-muted">
        Changes from version {data.base.versionNumber} to version{' '}
        {data.target.versionNumber}
        {data.identical ? ' · identical' : null}
      </p>
      {data.identical ? (
        <p className="text-body text-ink">These versions are identical.</p>
      ) : data.entries.length === 0 ? (
        <p className="text-body text-ink">
          No differences in the compared document content.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
          {data.entries.map((entry, index) => (
            <ComparisonEntryRow key={index} entry={entry} />
          ))}
        </ul>
      )}
      {data.entriesTruncated ? (
        <p className="text-caption text-muted" role="status">
          Only the first {DOCUMENT_COMPARISON_ENTRY_MAX_COUNT} differences are
          shown.
        </p>
      ) : null}
      {data.notes.map((note, index) => (
        <p key={index} className="text-caption text-muted">
          {note}
        </p>
      ))}
    </div>
  )
}

function ComparisonEntryRow({ entry }: { entry: DocumentComparisonEntry }) {
  const story =
    'storyPartName' in entry && entry.storyPartName !== 'word/document.xml'
      ? ` · ${entry.storyPartName}`
      : ''
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <span className="text-caption text-subtle">
        {entryLabel(entry)}
        {story}
      </span>
      <EntryBody entry={entry} />
    </li>
  )
}

function entryLabel(entry: DocumentComparisonEntry) {
  switch (entry.type) {
    case 'added':
      return 'Paragraph added'
    case 'removed':
      return 'Paragraph removed'
    case 'modified':
      return 'Paragraph modified'
    case 'formatted':
      return 'Formatting changed'
    case 'story':
      return 'Structure changed'
    case 'package':
      return packageAreaLabel(entry.area)
  }
}

function packageAreaLabel(area: string) {
  switch (area) {
    case 'styles':
      return 'Styles changed'
    case 'numbering':
      return 'List numbering changed'
    case 'relationships':
      return 'Document relationships changed'
    case 'comments':
      return 'Comments changed'
    case 'revisions':
      return 'Tracked revisions changed'
    default:
      return 'Document package changed'
  }
}

function EntryBody({ entry }: { entry: DocumentComparisonEntry }) {
  switch (entry.type) {
    case 'added':
      return (
        <p className="text-body break-words whitespace-pre-wrap text-success">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    case 'removed':
      return (
        <p className="text-body break-words whitespace-pre-wrap text-danger line-through">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    case 'modified':
      return (
        <p className="text-body break-words whitespace-pre-wrap text-ink">
          {entry.segments.map((segment, index) => (
            <span
              key={index}
              className={
                segment.kind === 'added'
                  ? 'text-success underline decoration-success underline-offset-4'
                  : segment.kind === 'removed'
                    ? 'text-danger line-through decoration-danger'
                    : undefined
              }
            >
              {segment.text}
            </span>
          ))}
        </p>
      )
    case 'formatted':
      return (
        <p className="text-body break-words whitespace-pre-wrap text-muted">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    default:
      return null
  }
}
