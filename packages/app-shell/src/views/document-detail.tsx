import type { ReactNode } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FileText, Trash } from '@phosphor-icons/react'
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Skeleton,
  useToast,
} from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import { useDeleteDocument, useDocument } from '../documents'

/**
 * Document detail — the contract route (PRD FR4). Receives route params as
 * props, renders real document metadata from GET /api/documents/:id (filename,
 * hash, size, status, versions), a redaction-runs region slot, and a child
 * <Outlet/> so feature sub-routes such as redact/$runId nest beneath it.
 */
export function DocumentDetailLayoutView({
  matterId,
  documentId,
  redactionRunsRegion,
}: {
  matterId: string
  documentId: string
  redactionRunsRegion?: ReactNode
}) {
  const deleteDocument = useDeleteDocument()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: me } = useCurrentUser()
  const document = useDocument(documentId)
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'

  // The document is loaded by id alone; guard against the URL's matterId not
  // matching the document's actual matter. Render not-found rather than show a
  // valid document under the wrong matter's chrome/back-link.
  const loaded = document.data
  const matterMismatch =
    !document.isLoading &&
    !document.isError &&
    loaded !== undefined &&
    loaded.document.matterId !== matterId

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/matters/$matterId"
          params={{ matterId: String(matterId) }}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to matter
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">
              Document
            </p>
            {document.isLoading ? (
              <Skeleton className="h-7 w-64" />
            ) : document.isError || !loaded ? (
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
                <FileText size={24} aria-hidden="true" />
                Document
              </h1>
            ) : (
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
                <FileText size={24} aria-hidden="true" />
                {loaded.document.currentVersion?.filename ??
                  loaded.document.logicalKey}
              </h1>
            )}
            <p className="text-sm text-muted">
              Matter <span className="font-mono text-ink">{matterId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">Immutable versions</Badge>
            {canManage ? (
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Delete document"
                    >
                      <Trash aria-hidden /> Delete
                    </Button>
                  }
                />
                <DialogContent size="md">
                  <DialogTitle>Delete document</DialogTitle>
                  <DialogDescription>
                    Deleting this document also removes its redaction runs.
                    Removals are soft — rows persist for audit and can be
                    restored by an operator.
                  </DialogDescription>
                  <div className="flex justify-end gap-2">
                    <DialogClose
                      render={<Button variant="ghost">Cancel</Button>}
                    />
                    <Button
                      variant="danger"
                      loading={deleteDocument.isPending}
                      onClick={async () => {
                        await deleteDocument.mutateAsync({
                          documentId,
                          matterId,
                        })
                        toast({ title: 'Document deleted' })
                        navigate({
                          to: '/matters/$matterId',
                          params: { matterId: String(matterId) },
                        })
                      }}
                    >
                      Delete document
                    </Button>
                  </div>
                  <DialogCloseButton />
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </div>
      </div>

      {matterMismatch && loaded ? (
        <EmptyState
          title="This document belongs to a different matter"
          body="The document exists, but it is not part of the matter in this URL. Open it from its own matter to see it in the right context."
          action={
            <Link
              className="font-semibold text-brand hover:text-brand-pressed"
              to="/matters/$matterId/documents/$documentId"
              params={{ matterId: loaded.document.matterId, documentId }}
            >
              Open under the correct matter
            </Link>
          }
        />
      ) : document.isError ? (
        <EmptyState
          title="Document not found"
          body="This document does not exist in your organisation, or your session may have expired."
        />
      ) : document.isLoading ? (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading document"
        >
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : loaded ? (
        <DocumentMetadata
          document={loaded.document}
          versions={loaded.versions}
        />
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-ink">Redaction runs</h2>
            <p className="text-sm text-muted">
              Create a run to detect and review sensitive information before
              this document enters AI-assisted workflows.
            </p>
          </div>
        </div>
        {redactionRunsRegion ?? (
          <EmptyState
            title="No redaction runs yet"
            body="When a run is created it appears here for review. This region is the contract surface the Redact review UI fills in."
          />
        )}
      </section>

      {/* Feature sub-routes (e.g. redact/$runId) render here. */}
      <Outlet />
    </div>
  )
}

function DocumentMetadata({
  document,
  versions,
}: {
  document: import('../documents').MatterDocumentRecord
  versions: import('../documents').DocumentVersionRecord[]
}) {
  const current = document.currentVersion
  const sizeLabel = current ? formatBytes(Number(current.sizeBytes)) : '—'

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-ink">Document details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <DetailRow
            label="Filename"
            value={current?.filename ?? document.logicalKey}
            mono
          />
          <DetailRow label="Status" value={current?.documentStatus ?? '—'} />
          <DetailRow label="File type" value={current?.fileType ?? '—'} />
          <DetailRow label="Size" value={sizeLabel} />
          <DetailRow
            label="SHA-256"
            value={truncateSha(current?.contentSha256)}
            mono
          />
          <DetailRow label="Sync state" value={current?.syncState ?? '—'} />
          <DetailRow
            label="Created"
            value={formatTimestamp(current?.createdAt)}
          />
          <DetailRow
            label="Updated"
            value={formatTimestamp(current?.updatedAt)}
          />
        </dl>
      </section>

      {versions.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-ink">Versions</h2>
          <ul className="flex flex-col divide-y divide-line">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-ink">
                    v{version.versionNumber} · {version.filename}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {version.fileType} ·{' '}
                    {formatBytes(Number(version.sizeBytes))}
                  </span>
                </div>
                <Badge
                  tone={
                    version.documentStatus === 'ready'
                      ? 'success'
                      : version.documentStatus === 'failed'
                        ? 'danger'
                        : 'info'
                  }
                >
                  {version.documentStatus}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wider text-subtle">
        {label}
      </dt>
      <dd
        className={
          'text-sm text-ink ' +
          (mono ? 'break-all font-mono text-xs' : 'truncate')
        }
      >
        {value}
      </dd>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function truncateSha(sha: string | undefined): string {
  if (!sha) return '—'
  return sha.length <= 16 ? sha : `${sha.slice(0, 16)}…`
}
