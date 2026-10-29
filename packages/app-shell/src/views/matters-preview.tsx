import { Link } from '@tanstack/react-router'
import { buttonClassName } from '@obiter/ui'
import type { MatterDocumentRecord } from '../documents'
import { formatDate } from '../format'
import { RedactedMark } from '../redacted-mark'
import { DocumentIcon } from './matter-documents-table'
import type { MatterRow } from './matters-rows'
import { MatterTile } from './matters-table'
import { MatterUploadButton } from './matter-upload'

export function MatterPreview({
  row,
  documents,
}: {
  row: MatterRow
  documents: MatterDocumentRecord[] | undefined
}) {
  const matter = row.matter
  const files = documents ?? []

  return (
    <div
      className="flex min-w-0 flex-col"
      role="region"
      aria-label={matter.name}
    >
      <div className="flex items-start gap-2 px-6 pt-6 pb-4">
        <MatterTile matter={matter} />
        <div className="min-w-0">
          <p className="text-item break-words text-ink">{matter.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-subtle">
            {matter.clientReference ? (
              <span className="font-mono">{matter.clientReference}</span>
            ) : null}
            <span>{matter.primaryJurisdiction}</span>
          </p>
          {matter.legalDomains.length > 0 ? (
            <p className="mt-1 text-caption text-subtle">
              {matter.legalDomains.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-line px-6 py-3">
        <p className="mb-2 flex items-center justify-between gap-2 text-caption text-subtle">
          <span>Documents</span>
          <span>
            {documents === undefined
              ? 'Loading…'
              : `${files.length} ${files.length === 1 ? 'file' : 'files'}`}
          </span>
        </p>
        {documents === undefined ? (
          <p className="py-2 text-meta text-subtle">Reading documents…</p>
        ) : files.length === 0 ? (
          <p className="py-2 text-meta text-subtle">No documents yet.</p>
        ) : (
          files.map((document) => {
            const version = document.currentVersion
            return (
              <div
                key={document.id}
                className="flex min-w-0 items-center gap-3 py-2"
              >
                <Link
                  to="/matters/$matterId/documents/$documentId"
                  params={{ matterId: matter.id, documentId: document.id }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <DocumentIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block text-meta break-words text-ink">
                      {version?.filename ?? document.logicalKey}
                    </span>
                    <span className="mt-1 block text-caption text-subtle">
                      {version
                        ? `Version ${version.versionNumber} · ${formatDate(version.createdAt)}`
                        : 'No version'}
                    </span>
                  </span>
                </Link>
                {version ? (
                  <RedactedMark
                    redaction={version.redaction}
                    producedAt={version.createdAt}
                  />
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-6 py-3">
        <Link
          to="/matters/$matterId"
          params={{ matterId: matter.id }}
          className={buttonClassName({
            variant: 'secondary',
            className: 'flex-1',
          })}
        >
          Open matter
        </Link>
        <MatterUploadButton matterId={matter.id} />
      </div>
    </div>
  )
}
