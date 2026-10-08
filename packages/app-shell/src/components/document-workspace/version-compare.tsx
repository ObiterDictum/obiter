import { useState } from 'react'
import { Button, Select } from '@obiter/ui'
import type {
  DocumentCompareResponse,
  DocumentComparisonEntry,
} from '@obiter/contracts'
import { DOCUMENT_COMPARISON_ENTRY_MAX_COUNT } from '@obiter/contracts'
import { useDocumentCompare } from '../../document-workspace-api'
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
  const options = comparable.map((version) => ({
    value: version.id,
    label: `v${version.versionNumber} · ${version.filename}`,
  }))

  return (
    <div
      className="flex flex-col gap-3 border-t border-line pt-3"
      aria-label="Compare versions"
    >
      <h3 className="text-sm font-semibold text-ink">Compare versions</h3>
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
      <p className="text-xs text-muted">
        v{data.base.versionNumber} → v{data.target.versionNumber}
        {data.identical ? ' — identical' : null}
      </p>
      {data.identical ? (
        <p className="text-sm text-ink">These versions are identical.</p>
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-ink">
          No differences in the compared document content.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {data.entries.map((entry, index) => (
            <ComparisonEntryRow key={index} entry={entry} />
          ))}
        </ul>
      )}
      {data.entriesTruncated ? (
        <p className="text-xs text-muted" role="status">
          Only the first {DOCUMENT_COMPARISON_ENTRY_MAX_COUNT} differences are
          shown.
        </p>
      ) : null}
      {data.notes.map((note, index) => (
        <p key={index} className="text-xs text-muted">
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
      <span className="text-xs font-medium tracking-wide text-subtle uppercase">
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
        <p className="text-sm break-words whitespace-pre-wrap text-success">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    case 'removed':
      return (
        <p className="text-sm break-words whitespace-pre-wrap text-danger line-through">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    case 'modified':
      return (
        <p className="text-sm break-words whitespace-pre-wrap text-ink">
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
        <p className="text-sm break-words whitespace-pre-wrap text-muted">
          {entry.text === '' ? '(empty paragraph)' : entry.text}
          {entry.textTruncated ? '…' : null}
        </p>
      )
    default:
      return null
  }
}
