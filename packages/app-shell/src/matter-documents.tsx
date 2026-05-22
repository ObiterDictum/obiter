import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Card, EmptyState, StatusPill } from '@ormont/ui'
import type { DocumentStatus, MatterDocument, SyncState } from '@ormont/contracts'
import {
  createDocumentMetadataMutationOptions,
  createMatterQueryOptions,
  deleteDocumentMutationOptions,
  formatApiError,
  listMatterDocumentsQueryOptions,
} from './api'
import { formatBytes, formatDateTime, labelFromToken } from './format'

function documentStatusTone(status: DocumentStatus) {
  if (status === 'ready') return 'sage'
  if (status === 'failed' || status === 'needs_review') return 'rust'
  return 'amber'
}

function syncStateTone(syncState: SyncState) {
  if (syncState === 'synced') return 'sage'
  if (syncState === 'failed' || syncState === 'conflict') return 'rust'
  return 'amber'
}

export function getMatterDocumentLabel(document: MatterDocument) {
  return document.currentVersion?.filename ?? document.logicalKey
}

export function describeMatterDocument(document: MatterDocument) {
  const version = document.currentVersion
  return {
    contentSha256: version?.contentSha256 ?? 'Missing current version metadata',
    createdAt: version ? formatDateTime(version.createdAt) : 'Missing current version metadata',
    fileType: version?.fileType ?? 'Missing current version metadata',
    label: getMatterDocumentLabel(document),
    size: version ? formatBytes(version.sizeBytes) : 'Missing current version metadata',
    status: version?.documentStatus ?? 'queued',
    syncState: version?.syncState ?? 'failed',
    versionNumber: version ? `v${version.versionNumber}` : 'No current version',
  }
}

export function getMatterDocumentListState(documents: MatterDocument[]) {
  return documents.length === 0 ? 'empty' : 'populated'
}

export function ApiMatterRouteView({ matterId }: { matterId: string }) {
  const matterQuery = useQuery(createMatterQueryOptions(matterId))
  const documentsQuery = useQuery(listMatterDocumentsQueryOptions(matterId))
  const queryClient = useQueryClient()
  const createDocument = useMutation(
    createDocumentMetadataMutationOptions(queryClient, matterId),
  )
  const deleteDocument = useMutation(deleteDocumentMutationOptions(queryClient, matterId))
  const [filename, setFilename] = useState('')
  const [fileType, setFileType] = useState('application/pdf')
  const [sizeBytes, setSizeBytes] = useState('0')
  const [contentSha256, setContentSha256] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createDocument.mutateAsync({
      filename,
      fileType,
      sizeBytes: Number(sizeBytes),
      contentSha256,
    })
    setFilename('')
    setFileType('application/pdf')
    setSizeBytes('0')
    setContentSha256('')
  }

  if (matterQuery.isLoading || documentsQuery.isLoading) {
    return (
      <Card>
        <p className="shell-copy">Loading matter and document metadata from the API...</p>
      </Card>
    )
  }

  if (matterQuery.isError) {
    return (
      <Card>
        <EmptyState
          title="Matter could not be loaded"
          body={`${formatApiError(matterQuery.error)} Return to matters, check your sign-in session, and try again.`}
          action={
            <Link className="shell-inline-link" to="/matters">
              Return to matters
            </Link>
          }
        />
      </Card>
    )
  }

  if (documentsQuery.isError) {
    return (
      <Card>
        <EmptyState
          title="Documents could not be loaded"
          body={`${formatApiError(documentsQuery.error)} Refresh the matter after confirming the API is running.`}
          action={
            <Link className="shell-inline-link" to="/matters">
              Return to matters
            </Link>
          }
        />
      </Card>
    )
  }

  if (!matterQuery.data || !documentsQuery.data) {
    return (
      <Card>
        <p className="shell-copy">Loading matter and document metadata from the API...</p>
      </Card>
    )
  }

  const matter = matterQuery.data.matter
  const documents = documentsQuery.data.documents

  return (
    <div className="shell-stack">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Matter documents</p>
          <h1 className="shell-header__title">{matter.name}</h1>
        </div>
        <Link className="shell-inline-link" to="/matters">
          All matters
        </Link>
      </section>

      <Card eyebrow={matter.clientReference || 'No client reference'} title="Document metadata">
        <p className="shell-copy">
          Binary file storage is not wired yet. This creates a document metadata record and its
          immutable initial version only.
        </p>
      </Card>

      <Card eyebrow="New document" title="Create metadata record">
        <form className="matter-form" onSubmit={handleSubmit}>
          <label className="matter-field">
            <span>Filename</span>
            <input value={filename} onChange={(event) => setFilename(event.target.value)} required />
          </label>
          <label className="matter-field">
            <span>File type</span>
            <input value={fileType} onChange={(event) => setFileType(event.target.value)} required />
          </label>
          <label className="matter-field">
            <span>Size bytes</span>
            <input
              min={0}
              step={1}
              type="number"
              value={sizeBytes}
              onChange={(event) => setSizeBytes(event.target.value)}
              required
            />
          </label>
          <label className="matter-field matter-field--wide">
            <span>Content SHA-256</span>
            <input
              value={contentSha256}
              onChange={(event) => setContentSha256(event.target.value)}
              required
            />
          </label>
          <button className="matter-button" disabled={createDocument.isPending} type="submit">
            {createDocument.isPending ? 'Creating document metadata...' : 'Create metadata record'}
          </button>
        </form>
        {createDocument.isError ? (
          <p className="matter-error" role="alert">
            {formatApiError(createDocument.error)} Confirm the metadata fields are valid and try
            again.
          </p>
        ) : null}
      </Card>

      <Card eyebrow="Documents" title="Current matter documents">
        {getMatterDocumentListState(documents) === 'empty' ? (
          <EmptyState
            title="No document metadata records"
            body="Create a metadata record when you have the filename, MIME type, byte size, and content hash. Storage upload is not part of this screen yet."
          />
        ) : (
          <div className="document-list">
            {documents.map((document) => (
              <DocumentRow
                document={document}
                isDeleting={deleteDocument.isPending}
                key={document.id}
                onDelete={() => deleteDocument.mutate(document.id)}
              />
            ))}
          </div>
        )}
        {deleteDocument.isError ? (
          <p className="matter-error" role="alert">
            {formatApiError(deleteDocument.error)} Refresh the matter and try the soft-delete again.
          </p>
        ) : null}
      </Card>
    </div>
  )
}

function DocumentRow({
  document,
  isDeleting,
  onDelete,
}: {
  document: MatterDocument
  isDeleting: boolean
  onDelete: () => void
}) {
  const details = describeMatterDocument(document)
  const isDeleted = document.deletedAt !== null

  return (
    <article className="document-list__item" data-deleted={isDeleted ? 'true' : 'false'}>
      <div className="document-list__header">
        <div>
          <h2>{details.label}</h2>
          <p>
            {details.versionNumber} · {details.fileType} · {details.size}
          </p>
        </div>
        <div className="document-list__status">
          <StatusPill tone={documentStatusTone(details.status)}>
            {labelFromToken(details.status)}
          </StatusPill>
          <StatusPill tone={syncStateTone(details.syncState)}>
            {labelFromToken(details.syncState)}
          </StatusPill>
        </div>
      </div>
      <dl className="document-list__meta">
        <div>
          <dt>Document id</dt>
          <dd>{document.id}</dd>
        </div>
        <div>
          <dt>Matter id</dt>
          <dd>{document.matterId}</dd>
        </div>
        <div>
          <dt>Current version id</dt>
          <dd>{document.currentVersionId ?? 'No current version'}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>{details.contentSha256}</dd>
        </div>
        <div>
          <dt>Version created</dt>
          <dd>{details.createdAt}</dd>
        </div>
        <div>
          <dt>Deleted</dt>
          <dd>{document.deletedAt ? formatDateTime(document.deletedAt) : 'No'}</dd>
        </div>
      </dl>
      <button
        className="matter-button matter-button--secondary"
        disabled={isDeleting || isDeleted}
        onClick={onDelete}
        type="button"
      >
        {isDeleting ? 'Soft-deleting document...' : 'Soft-delete'}
      </button>
    </article>
  )
}
