import { ArrowRight } from '@phosphor-icons/react'
import { Badge, Button, DockedPanel, type PanelPopout } from '@obiter/ui'
import type { ReactNode } from 'react'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import { formatBytes, formatDateTime } from '../../format'
import { RedactedMark } from '../../redacted-mark'

/** The product's name for a stored file type, not the raw MIME. */
function fileTypeLabel(fileType: string) {
  switch (fileType.toLowerCase()) {
    case 'docx':
      return 'Word document (.docx)'
    case 'pdf':
      return 'PDF document (.pdf)'
    case 'txt':
      return 'Plain text (.txt)'
    default:
      return fileType.toUpperCase()
  }
}

/**
 * The `?` panel: everything the editor header used to carry as loose metadata.
 * It reads the document the route already loaded, so opening it costs no
 * request, and it keeps the version list where the person asked for details
 * rather than above the page.
 */
export function DocumentInfoPanel({
  open,
  onClose,
  popout,
  document,
  matterLink,
  versions,
  onViewVersion,
}: {
  open: boolean
  onClose: () => void
  popout?: PanelPopout
  document: MatterDocumentRecord
  /** The matter's name and reference, as a node: only the route has them. */
  matterLink?: ReactNode
  versions: DocumentVersionRecord[]
  onViewVersion?: (versionId: string) => void
}) {
  if (!open) return null
  const current = document.currentVersion
  const newestFirst = [...versions].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  )
  return (
    <DockedPanel
      title="Document information"
      onClose={onClose}
      popout={popout}
      footer={
        <p className="text-caption text-subtle">
          A version is a locked copy. Editing always creates a new version, so a
          copy you have shared stays exactly as it was.
        </p>
      }
    >
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption">
          <dt className="text-subtle">Name</dt>
          <dd className="min-w-0 break-words text-ink">
            {current?.filename ?? document.logicalKey}
          </dd>
          <dt className="text-subtle">Type</dt>
          <dd className="text-ink">{fileTypeLabel(current?.fileType ?? '')}</dd>
          <dt className="text-subtle">Size</dt>
          <dd className="text-ink">
            {current ? formatBytes(Number(current.sizeBytes)) : '—'}
          </dd>
          <dt className="text-subtle">Created</dt>
          <dd className="text-ink">
            {formatDateTime(current?.createdAt ?? document.createdAt)}
          </dd>
          <dt className="text-subtle">Updated</dt>
          <dd className="text-ink">
            {formatDateTime(current?.updatedAt ?? document.updatedAt)}
          </dd>
        </dl>

        {matterLink ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-item text-ink">Matter</h3>
            <div className="text-caption text-ink">{matterLink}</div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-item text-ink">
            {versions.length === 1
              ? '1 version'
              : `${String(versions.length)} versions`}
          </h3>
          <ul className="flex flex-col">
            {newestFirst.map((version) => (
              <li
                key={version.id}
                className="flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
              >
                <span className="w-6 shrink-0 text-caption tabular-nums text-subtle">
                  v{version.versionNumber}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="truncate text-item text-ink">
                      Version {String(version.versionNumber)}
                    </span>
                    <span className="shrink-0 text-caption text-subtle">
                      {version.id === document.currentVersionId
                        ? 'Current version'
                        : version.versionNumber === 1
                          ? 'Original upload'
                          : null}
                    </span>
                    <RedactedMark
                      redaction={version.redaction}
                      producedAt={version.createdAt}
                    />
                  </span>
                  <span className="truncate text-caption text-subtle">
                    {formatDateTime(version.createdAt)} ·{' '}
                    {formatBytes(Number(version.sizeBytes))}
                  </span>
                </span>
                {version.documentStatus !== 'ready' ? (
                  <Badge
                    tone={
                      version.documentStatus === 'failed' ? 'danger' : 'info'
                    }
                  >
                    {version.documentStatus}
                  </Badge>
                ) : version.id === document.currentVersionId ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewVersion?.(version.id)}
                  >
                    View
                    <ArrowRight size={12} aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DockedPanel>
  )
}
