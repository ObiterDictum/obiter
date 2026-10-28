import { Link } from '@tanstack/react-router'
import { ArrowRight, FileText } from '@phosphor-icons/react'
import { Card, CardBody, CardHead, Skeleton } from '@obiter/ui'
import { formatDate } from '../format'
import { matterInitials } from '../matters'

export interface RecentDocument {
  documentId: string
  matterId: string
  matterName: string
  filename: string
  updatedAt: string
}

export interface MatterSummary {
  id: string
  name: string
  clientReference: string
  updatedAt: string
  /** Null while the document list is still loading or failed. */
  documentCount: number | null
}

export function RecentDocumentsCard({
  documents,
  loading,
}: {
  documents: RecentDocument[]
  loading: boolean
}) {
  if (!loading && documents.length === 0) return null
  return (
    <Card aria-labelledby="recent-documents">
      <CardHead title="Recent documents" titleId="recent-documents">
        <Link
          to="/matters"
          className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink"
        >
          All documents <ArrowRight size={12} aria-hidden />
        </Link>
      </CardHead>
      {loading ? (
        <RowsSkeleton />
      ) : (
        <ul>
          {documents.map((document) => (
            <li
              key={document.documentId}
              className="[&+li]:border-t [&+li]:border-line"
            >
              <Link
                to="/matters/$matterId/documents/$documentId"
                params={{
                  matterId: document.matterId,
                  documentId: document.documentId,
                }}
                className="flex min-h-row items-center gap-3 px-6 py-4 hover:bg-hover"
              >
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-sm bg-fill text-subtle"
                  aria-hidden="true"
                >
                  <FileText size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-item text-ink"
                    title={document.filename}
                  >
                    {document.filename}
                  </span>
                  {/* One line, as the mock-up has it: a wrapped matter name
                      made every row two lines taller and pushed the date out of
                      sight. The full name stays available as a tooltip. */}
                  <span
                    className="mt-1 block truncate text-meta text-muted"
                    title={document.matterName}
                  >
                    {document.matterName}
                  </span>
                  <span className="mt-1 block text-caption text-subtle">
                    {formatDate(document.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function YourMattersCard({
  matters,
  loading,
  error,
  totalMatters,
}: {
  matters: MatterSummary[]
  loading: boolean
  error: string | null
  totalMatters: number
}) {
  return (
    <Card aria-labelledby="your-matters">
      <CardHead title="Your matters" titleId="your-matters">
        <Link
          to="/matters"
          className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink"
        >
          {totalMatters > 0 ? `All ${totalMatters}` : 'All matters'}
          <ArrowRight size={12} aria-hidden />
        </Link>
      </CardHead>
      {loading ? (
        <RowsSkeleton />
      ) : error ? (
        <CardBody>
          <p className="text-meta text-muted">
            Your matters could not be loaded.{' '}
            <Link to="/matters" className="text-ink hover:text-brand">
              Open Matters
            </Link>{' '}
            to retry.
          </p>
        </CardBody>
      ) : matters.length === 0 ? (
        <CardBody>
          <p className="text-meta text-muted">No active matters yet.</p>
        </CardBody>
      ) : (
        <ul>
          {matters.map((matter) => (
            <li key={matter.id} className="[&+li]:border-t [&+li]:border-line">
              <Link
                to="/matters/$matterId"
                params={{ matterId: matter.id }}
                className="flex min-h-row items-center gap-3 px-6 py-4 hover:bg-hover"
              >
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-sm bg-fill text-caption tracking-tight text-muted"
                  aria-hidden="true"
                >
                  {matterInitials(matter)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-item text-ink"
                    title={matter.name}
                  >
                    {matter.name}
                  </span>
                  <span className="mt-1 block text-meta break-words text-muted">
                    {matterLines(matter)}
                  </span>
                  <span className="mt-1 block text-caption text-subtle">
                    {formatDate(matter.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** A count that is still loading is left out rather than shown as zero. */
function matterLines(matter: MatterSummary) {
  const documents =
    matter.documentCount === null
      ? null
      : `${matter.documentCount} ${matter.documentCount === 1 ? 'document' : 'documents'}`
  return [documents, matter.clientReference || null].filter(Boolean).join(' · ')
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-6 pb-6" aria-busy="true">
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
