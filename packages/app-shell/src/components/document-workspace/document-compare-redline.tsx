import { useState } from 'react'
import { ArrowsLeftRight, X } from '@phosphor-icons/react'
import { Button, DockedPanel, Select, cn } from '@obiter/ui'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  type DocumentComparisonEntry,
  type DocumentCompareResponse,
} from '@obiter/contracts'
import { useDocumentCompare } from '../../document-workspace-api'
import { formatDate } from '../../format'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentDesk, DocumentPage } from './document-page'
import { QueryError } from './workspace-chrome'

/**
 * Version comparison as a redline over the document, read-only. The panel
 * lists the differences in order and jumping to one turns the paper to it;
 * the direction is stated in words and can be swapped, because a diff read
 * the wrong way round inverts every decision made from it.
 */
export function DocumentCompareRedline({
  documentId,
  versions,
  onClose,
}: {
  documentId: string
  versions: DocumentVersionRecord[]
  onClose: () => void
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
  const [active, setActive] = useState(0)
  // Versions arrive newest-first; the default pair is the previous version
  // against the current one — the question "what just changed" asks.
  const resolvedBase = baseId ?? comparable[1]?.id
  const resolvedTarget = targetId ?? comparable[0]?.id
  const options = comparable.map((version) => ({
    value: version.id,
    label: `Version ${String(version.versionNumber)} · ${formatDate(version.createdAt)}`,
  }))
  const base = comparable.find((version) => version.id === resolvedBase)
  const target = comparable.find((version) => version.id === resolvedTarget)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-item text-ink">
            Comparing versions · read only
          </span>
          <span className="text-caption text-muted">
            {base && target
              ? `Changes from version ${String(base.versionNumber)} to version ${String(target.versionNumber)}`
              : 'Choose a base version and a version to compare it with.'}
          </span>
        </div>
        <Select
          ariaLabel="Base"
          size="compact"
          options={options}
          value={resolvedBase}
          onValueChange={(value) => setBaseId(value ?? undefined)}
          className="w-56"
        />
        <span aria-hidden className="text-muted">
          →
        </span>
        <Select
          ariaLabel="Compare to"
          size="compact"
          options={options}
          value={resolvedTarget}
          onValueChange={(value) => setTargetId(value ?? undefined)}
          className="w-56"
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Swap base and comparison"
          onClick={() => {
            setBaseId(resolvedTarget)
            setTargetId(resolvedBase)
            setPair(null)
            setActive(0)
          }}
          iconStart={<ArrowsLeftRight size={12} aria-hidden />}
        >
          Swap
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (resolvedBase && resolvedTarget) {
              setActive(0)
              setPair({
                baseVersionId: resolvedBase,
                targetVersionId: resolvedTarget,
              })
            }
          }}
        >
          Compare
        </Button>
        <div className="ms-auto">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close comparison"
            onClick={onClose}
            iconStart={<X size={14} aria-hidden />}
          >
            Close
          </Button>
        </div>
      </div>
      {pair ? (
        <CompareBody
          documentId={documentId}
          baseVersionId={pair.baseVersionId}
          targetVersionId={pair.targetVersionId}
          active={active}
          onActive={setActive}
          onClose={onClose}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-body text-muted">
          Choose two versions and select Compare to see the redline.
        </div>
      )}
    </div>
  )
}

function CompareBody({
  documentId,
  baseVersionId,
  targetVersionId,
  active,
  onActive,
  onClose,
}: {
  documentId: string
  baseVersionId: string
  targetVersionId: string
  active: number
  onActive: (index: number) => void
  onClose: () => void
}) {
  const compare = useDocumentCompare(documentId, baseVersionId, targetVersionId)
  if (compare.isLoading) {
    return (
      <div className="p-6 text-body text-muted" aria-busy="true">
        Comparing versions…
      </div>
    )
  }
  if (compare.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={compare.error}
          fallback="The versions could not be compared."
        />
      </div>
    )
  }
  if (!compare.data) return null
  return (
    <DocumentComparisonView
      data={compare.data}
      active={active}
      onActive={onActive}
      onClose={onClose}
    />
  )
}

/** The redline over the paper, with the difference list beside it. */
export function DocumentComparisonView({
  data,
  active,
  onActive,
  onClose,
}: {
  data: DocumentCompareResponse
  active: number
  onActive: (index: number) => void
  onClose: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden lg:flex-row">
      <DocumentDesk>
        <div className="flex w-full min-w-0 flex-col items-center gap-6">
          <DocumentPage zoom={90}>
            <div className="flex flex-col gap-3 p-14" data-compare-redline>
              <p className="text-caption text-muted">
                Changes from version {data.base.versionNumber} to version{' '}
                {data.target.versionNumber}
                {data.identical ? ' · identical' : null}
              </p>
              {data.identical ? (
                <p className="text-body text-ink">
                  These versions are identical.
                </p>
              ) : data.entries.length === 0 ? (
                <p className="text-body text-ink">
                  No differences in the compared document content.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {data.entries.map((entry, index) => (
                    <li
                      key={index}
                      id={`compare-entry-${String(index)}`}
                      aria-current={index === active ? 'true' : undefined}
                      className={cn(
                        'rounded-sm px-1',
                        index === active && 'bg-warning-soft',
                      )}
                    >
                      <EntryBody entry={entry} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </DocumentPage>
        </div>
      </DocumentDesk>
      <DockedPanel title="Differences" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-caption text-muted">
            {data.entries.length === 0
              ? 'No differences.'
              : `${String(data.entries.length)} difference${data.entries.length === 1 ? '' : 's'}, in document order.`}
          </p>
          <ul className="flex flex-col">
            {data.entries.map((entry, index) => (
              <li key={index} className="border-t border-line first:border-t-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                  aria-label={`Show difference ${String(index + 1)}: ${entryLabel(entry)}`}
                  aria-current={index === active ? 'true' : undefined}
                  onClick={() => {
                    onActive(index)
                    const target = document.getElementById(
                      `compare-entry-${String(index)}`,
                    )
                    target?.scrollIntoView?.({ block: 'center' })
                  }}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-caption text-subtle">
                      {entryLabel(entry)}
                    </span>
                    <span className="truncate text-body text-ink">
                      {entryPreview(entry)}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          {data.entriesTruncated ? (
            <p className="text-caption text-muted" role="status">
              Only the first {DOCUMENT_COMPARISON_ENTRY_MAX_COUNT} differences
              are shown.
            </p>
          ) : null}
          {data.notes.map((note, index) => (
            <p key={index} className="text-caption text-muted">
              {note}
            </p>
          ))}
        </div>
      </DockedPanel>
    </div>
  )
}

export function entryLabel(entry: DocumentComparisonEntry) {
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

function entryPreview(entry: DocumentComparisonEntry) {
  if (entry.type === 'story' || entry.type === 'package') return ''
  if (entry.type === 'modified') {
    return entry.segments.map((segment) => segment.text).join('')
  }
  return entry.text
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
        <p className="text-body break-words whitespace-pre-wrap text-success underline">
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
    case 'story':
    case 'package':
      return (
        <p className="text-caption text-muted">
          {entryLabel(entry)}
          {'storyPartName' in entry && entry.storyPartName !== 'word/document.xml'
            ? ` · ${entry.storyPartName}`
            : ''}
        </p>
      )
  }
}
