import { useState, type ReactNode } from 'react'
import { FileArrowDown } from '@phosphor-icons/react'
import { EmptyState } from '@obiter/ui'
import { downloadBlob, downloadPlainText } from '../../document-edits'
import { workspaceKind } from '../../document-kind'
import {
  fetchDocumentDownload,
  useDocumentPdfView,
  useDocumentText,
} from '../../document-workspace-api'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentDraftStatusProvider } from './document-draft-status'
import { VerificationWorkspaceProvider } from '../verification/verification-context'
import { VerificationDock } from '../verification/verification-dock'
import { DocxWorkspace } from './docx-workspace'
import { DocumentDesk } from './document-page'
import { DocumentPdfPages } from './pdf-view'
import { IconButton, ToolbarGroup } from './ribbon-primitives'
import { DocumentWorkspaceToolbar } from './toolbar'
import {
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
} from './workspace-chrome'
import type { DocumentWorkspaceLayout } from './workspace-chrome'

type DocumentWorkspaceProps = {
  documentId: string
  version: DocumentVersionRecord | null | undefined
  layout?: DocumentWorkspaceLayout
}

/**
 * The document is the workspace lifecycle boundary: keying the body on
 * documentId remounts it on a switch, so no unsaved draft, pending insert,
 * selection or caret from document A can render, mutate, save or hold focus in
 * document B. Same-document rerenders keep their key and state. A switch is
 * prompt-free and unsaved drafts are persisted per tab (E45), so returning to A
 * restores A's unsaved work instead of destroying it.
 */
export function DocumentWorkspace(props: DocumentWorkspaceProps) {
  const kind = workspaceKind(props.version?.fileType)
  return (
    // The providers own document-scoped interaction state: the verification
    // selection, open panel, index, marker map and measured reasons. Keying the
    // outermost provider on the document id means a switch remounts them too,
    // so no marker, reason or panel from document A can render for document B.
    <DocumentDraftStatusProvider key={props.documentId}>
      <VerificationWorkspaceProvider
        documentId={props.documentId}
        mappable={kind === 'docx'}
      >
        <DocumentWorkspaceBody key={props.documentId} {...props} />
      </VerificationWorkspaceProvider>
    </DocumentDraftStatusProvider>
  )
}

function DocumentWorkspaceBody({
  documentId,
  version,
  layout = 'page',
}: DocumentWorkspaceProps) {
  const kind = workspaceKind(version?.fileType)
  const ready = version?.documentStatus === 'ready'

  if (!version) return null
  // The stored failureReason is already a curated user-facing sentence (the
  // API maps internal parser diagnostics to a generic message before
  // persisting), so it is shown verbatim rather than as an error code.
  if (version.documentStatus === 'failed') {
    return (
      <div className="flex h-full flex-col">
        <VerificationDock />
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="This document could not be opened"
            body={
              version.failureReason ??
              'The document text could not be read. Try uploading it again.'
            }
          />
        </div>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="flex h-full flex-col">
        <VerificationDock />
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="Document is not ready to open"
            body={`Status is ${version.documentStatus}. The workspace opens when extraction finishes.`}
          />
        </div>
      </div>
    )
  }
  // Uploads are limited to DOCX, PDF and TXT, so `other` is only a legacy
  // row, but it must still be downloadable, never a dead end.
  if (kind === 'other') {
    return (
      <VerifiedViewer>
        <UnsupportedWorkspace
          documentId={documentId}
          filename={version.filename}
          layout={layout}
        />
      </VerifiedViewer>
    )
  }
  if (kind === 'txt') {
    return (
      <VerifiedViewer>
        <TxtWorkspace
          documentId={documentId}
          filename={version.filename}
          layout={layout}
        />
      </VerifiedViewer>
    )
  }
  if (kind === 'pdf') {
    return (
      <VerifiedViewer>
        <PdfWorkspace
          documentId={documentId}
          filename={version.filename}
          layout={layout}
        />
      </VerifiedViewer>
    )
  }
  return (
    <VerifiedViewer>
      <DocxWorkspace
        documentId={documentId}
        versionId={version.id}
        matterId={version.matterId}
        filename={version.filename}
        layout={layout}
      />
    </VerifiedViewer>
  )
}

/**
 * A viewer with the document-level Verify control above it. The control is part
 * of the document workspace rather than a separate route region, so every
 * surface that opens a document gets the same interaction and none can quietly
 * lose it.
 */
function VerifiedViewer({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <VerificationDock />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

async function downloadOriginal(documentId: string, filename: string) {
  downloadBlob(filename, await fetchDocumentDownload(documentId))
}

/** Download affordance shared by the viewers without an export of their own. */
function useDownloadOriginal(documentId: string, filename: string) {
  const [error, setError] = useState<string | null>(null)

  function download() {
    setError(null)
    void downloadOriginal(documentId, filename).catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : 'Download failed.'),
    )
  }

  return { downloadError: error, download }
}

function DownloadRibbon({
  onDownload,
  note,
  error,
}: {
  onDownload: () => void
  note: string
  error: string | null
}) {
  return (
    <WorkspaceRibbon>
      <div
        className="flex flex-wrap items-center gap-1 px-3 py-2"
        role="toolbar"
        aria-label="Document tools"
      >
        <ToolbarGroup label="File">
          <IconButton
            label="Download"
            onClick={onDownload}
            icon={<FileArrowDown size={16} aria-hidden />}
          />
        </ToolbarGroup>
        <span className="pl-2 text-xs text-muted">{note}</span>
      </div>
      {error ? (
        <p className="px-3 pb-2 text-sm text-danger" role="status">
          {error}
        </p>
      ) : null}
    </WorkspaceRibbon>
  )
}

function TxtWorkspace({
  documentId,
  filename,
  layout,
}: {
  documentId: string
  filename: string
  layout: DocumentWorkspaceLayout
}) {
  const textQuery = useDocumentText(documentId)
  const { downloadError, download } = useDownloadOriginal(documentId, filename)

  return (
    <WorkspaceShell layout={layout}>
      <DownloadRibbon
        note="Plain text, not editable"
        error={downloadError}
        onDownload={download}
      />
      {textQuery.isLoading ? (
        <LoadingBlock label="Loading document text" />
      ) : textQuery.isError ? (
        <QueryError
          error={textQuery.error}
          fallback="The document text could not be loaded."
        />
      ) : textQuery.data ? (
        <DocumentDesk>
          <pre className="mx-auto w-full max-w-3xl rounded bg-surface p-6 text-sm leading-relaxed whitespace-pre-wrap text-ink">
            {textQuery.data.text}
          </pre>
        </DocumentDesk>
      ) : null}
    </WorkspaceShell>
  )
}

function UnsupportedWorkspace({
  documentId,
  filename,
  layout,
}: {
  documentId: string
  filename: string
  layout: DocumentWorkspaceLayout
}) {
  const { downloadError, download } = useDownloadOriginal(documentId, filename)

  return (
    <WorkspaceShell layout={layout}>
      <DownloadRibbon
        note="Download to open elsewhere"
        error={downloadError}
        onDownload={download}
      />
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="No in-product viewer for this file type"
          body="Word documents open in the model editor, PDFs open as a read-only layout view, and plain text opens as text. Download this file to open it elsewhere."
        />
      </div>
    </WorkspaceShell>
  )
}

function PdfWorkspace({
  documentId,
  filename,
  layout,
}: {
  documentId: string
  filename: string
  layout: DocumentWorkspaceLayout
}) {
  const view = useDocumentPdfView(documentId)
  const [zoom, setZoom] = useState(100)
  const [pageIndex, setPageIndex] = useState(0)
  const { downloadError, download } = useDownloadOriginal(documentId, filename)

  return (
    <WorkspaceShell layout={layout}>
      <WorkspaceRibbon>
        <DocumentWorkspaceToolbar
          kind="pdf"
          dirty={false}
          saving={false}
          trackChanges={false}
          zoom={zoom}
          commentsOpen={false}
          changesOpen={false}
          authoritiesOpen={false}
          commentCount={0}
          changeCount={0}
          presence={[]}
          onToggleComments={() => undefined}
          onToggleChanges={() => undefined}
          onToggleAuthorities={() => undefined}
          onInsertAuthority={() => undefined}
          onToggleTrackChanges={() => undefined}
          onZoom={setZoom}
          onExportText={() => {
            if (view.data) downloadPlainText(filename, view.data.text)
          }}
          onDownload={download}
          onSave={() => undefined}
          onInsertParagraph={() => undefined}
          onDeleteParagraph={() => undefined}
          canEdit={false}
        />
        {downloadError ? (
          <p className="px-3 pb-2 text-sm text-danger" role="status">
            {downloadError}
          </p>
        ) : null}
      </WorkspaceRibbon>
      {view.isLoading ? (
        <LoadingBlock label="Loading PDF layout" />
      ) : view.isError ? (
        <QueryError
          error={view.error}
          fallback="The PDF layout could not be loaded."
        />
      ) : view.data ? (
        <DocumentDesk>
          <DocumentPdfPages
            view={view.data}
            pageIndex={pageIndex}
            onPageIndexChange={setPageIndex}
            zoom={zoom}
          />
        </DocumentDesk>
      ) : null}
    </WorkspaceShell>
  )
}
