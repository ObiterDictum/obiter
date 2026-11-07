import { useMutation, useQueryClient } from '@tanstack/react-query'
import { documentVersionRestoreResponseSchema } from '@obiter/contracts'
import { apiFetch } from '../api'
import {
  DocumentDraftStatusProvider,
  useDocumentDraftStatus,
} from '../components/document-workspace/document-draft-status'
import { useState, type ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { EmptyState, Skeleton } from '@obiter/ui'
import { useDocument } from '../documents'
import { useMatter } from '../matters'
import { ContentFrame } from '../content-frame'
import { DocumentWorkspace } from '../components/document-workspace/workspace'
import { DocumentVersionView } from '../components/document-workspace/document-version-view'
import { documentRedactionRunsId } from '../components/document-workspace/document-actions'
import { DocumentHistoryPortal } from '../components/document-workspace/document-history-tab'
import {
  DocumentTabsNotices,
  type DocumentTabsNoticeKind,
} from '../components/document-workspace/document-right-slot'
import { workspaceKind } from '../document-kind'

export function DocumentDetailLayoutView(
  props: Parameters<typeof DocumentDetailBody>[0],
) {
  return (
    <DocumentDraftStatusProvider
      key={props.documentId}
      onDirtyChange={props.onDocumentEdited}
    >
      <DocumentDetailBody {...props} />
    </DocumentDraftStatusProvider>
  )
}

function DocumentDetailBody({
  matterId,
  documentId,
  redactionRunsRegion,
  onDocumentEdited,
}: {
  matterId: string
  documentId: string
  redactionRunsRegion?: ReactNode
  onDocumentEdited?: () => void
}) {
  const document = useDocument(documentId)
  const queryClient = useQueryClient()
  const draft = useDocumentDraftStatus()
  const [restoredVersionId, setRestoredVersionId] = useState<string>()
  const [restoreNotice, setRestoreNotice] = useState<string>()
  const restore = useMutation({
    mutationFn: async (versionId: string) => {
      if (draft?.dirty) throw new Error('Save or discard your changes first.')
      return documentVersionRestoreResponseSchema.parse(
        await apiFetch(
          `/api/documents/${documentId}/versions/${versionId}/restore`,
          {
            method: 'POST',
            body: JSON.stringify({
              expectedCurrentVersionId:
                document.data?.document.currentVersionId,
            }),
          },
        ),
      )
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      setRestoredVersionId(result.versionId)
      setSelectedVersionId(undefined)
      setRestoreNotice('Version restored as a new current version.')
      onDocumentEdited?.()
    },
  })
  const restoreDisabledReason = draft?.dirty
    ? 'Save or discard your changes first.'
    : restore.isPending
      ? 'Restoring version…'
      : undefined
  const matter = useMatter(matterId)
  const [selectedVersionId, setSelectedVersionId] = useState<string>()
  const selectedVersion = document.data?.versions.find(
    (version) => version.id === selectedVersionId,
  )
  const viewingHistorical =
    selectedVersion !== undefined &&
    selectedVersion.documentStatus === 'ready' &&
    selectedVersion.id !== document.data?.document.currentVersionId

  const loaded = document.data
  const matterMismatch =
    !document.isLoading &&
    !document.isError &&
    loaded !== undefined &&
    loaded.document.matterId !== matterId
  const current = loaded?.document.currentVersion
  const notice: DocumentTabsNoticeKind | null = document.isLoading
    ? { kind: 'loading' }
    : document.isError || matterMismatch || !current
      ? { kind: 'unavailable' }
      : viewingHistorical
        ? {
            kind: 'historical',
            versionNumber: selectedVersion.versionNumber,
            onReturn: () => setSelectedVersionId(undefined),
          }
        : current.documentStatus === 'failed'
          ? { kind: 'unavailable' }
          : current.documentStatus !== 'ready'
            ? { kind: 'not-ready' }
            : workspaceKind(current.fileType) !== 'docx'
              ? { kind: 'not-word' }
              : null
  const rightSlotPanels = (
    <>
      {notice ? <DocumentTabsNotices notice={notice} /> : null}
      <DocumentHistoryPortal
        state={
          document.isError
            ? { status: 'error', error: document.error }
            : loaded
              ? { status: 'ready', ...loaded }
              : { status: 'loading' }
        }
        viewingVersionId={viewingHistorical ? selectedVersionId : undefined}
        onSelect={setSelectedVersionId}
        onRestore={(versionId) => restore.mutate(versionId)}
        restoreDisabledReason={restoreDisabledReason}
      />
    </>
  )
  const matterLink = (
    <Link
      to="/matters/$matterId"
      params={{ matterId: String(matterId) }}
      className="min-w-0 truncate text-subtle hover:text-ink"
      title={matter.data?.name}
    >
      {matter.data?.name ?? 'Matter'}
    </Link>
  )

  if (matterMismatch && loaded) {
    return (
      <ContentFrame className="py-14">
        {rightSlotPanels}
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
      </ContentFrame>
    )
  }
  if (document.isError) {
    return (
      <ContentFrame className="py-14">
        {rightSlotPanels}
        <EmptyState
          title="Document not found"
          body="This document does not exist in your organisation, or your session may have expired."
        />
      </ContentFrame>
    )
  }
  if (document.isLoading || !loaded) {
    return (
      <ContentFrame className="py-14">
        {rightSlotPanels}
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading document"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </ContentFrame>
    )
  }

  return (
    <div className="flex flex-col">
      {rightSlotPanels}
      {restoreNotice ? <p role="status">{restoreNotice}</p> : null}
      {restore.isError ? <p role="alert">{restore.error.message}</p> : null}
      <div className="h-[calc(100dvh-5.5rem)] min-h-[34rem] shrink-0">
        {viewingHistorical && selectedVersion ? (
          <ContentFrame className="flex h-full flex-col py-8">
            <DocumentVersionView
              documentId={documentId}
              version={selectedVersion}
              onExit={() => setSelectedVersionId(undefined)}
              onRestore={() => restore.mutate(selectedVersion.id)}
              restoreDisabledReason={restoreDisabledReason}
            />
          </ContentFrame>
        ) : null}
        <div
          className={viewingHistorical ? 'hidden' : 'h-full'}
          inert={restore.isPending}
        >
          <DocumentWorkspace
            key={restoredVersionId ?? documentId}
            documentId={documentId}
            version={loaded.document.currentVersion}
            document={loaded.document}
            versions={loaded.versions}
            onViewVersion={setSelectedVersionId}
            onDocumentEdited={onDocumentEdited}
            headerLinks={{ matter: matterLink }}
          />
        </div>
      </div>

      <ContentFrame className="flex flex-col gap-4 py-8">
        <section
          id={documentRedactionRunsId}
          tabIndex={-1}
          aria-label="Redaction runs"
          className="flex flex-col gap-3 rounded-lg bg-surface p-6 focus:outline-2 focus:outline-offset-2 focus:outline-brand"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-section text-ink">Redaction runs</h2>
            <p className="text-meta text-muted">
              Create a run to detect and review sensitive information before
              this document enters AI-assisted workflows.
            </p>
          </div>
          {redactionRunsRegion ?? (
            <EmptyState
              title="No redaction runs yet"
              body="When a run is created it appears here for review. This region is the contract surface the Redact review UI fills in."
            />
          )}
        </section>

        <Outlet />
      </ContentFrame>
    </div>
  )
}
