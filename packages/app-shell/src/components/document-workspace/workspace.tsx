import { useState } from 'react'
import { EmptyState } from '@obiter/ui'
import { downloadPlainText } from '../../document-edits'
import { workspaceKind } from '../../document-kind'
import { useDocumentPdfView } from '../../document-workspace-api'
import type { DocumentVersionRecord } from '../../documents'
import { DocxWorkspace } from './docx-workspace'
import { DocumentDesk } from './document-page'
import { DocumentPdfPages } from './pdf-view'
import { PdfRibbon } from './ribbon'
import {
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
} from './workspace-chrome'
import type { DocumentWorkspaceLayout } from './workspace-chrome'

export function DocumentWorkspace({
  documentId,
  version,
  layout = 'page',
}: {
  documentId: string
  version: DocumentVersionRecord | null | undefined
  layout?: DocumentWorkspaceLayout
}) {
  const kind = workspaceKind(version?.fileType)
  const ready = version?.documentStatus === 'ready'

  if (!version) return null
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title="Document is not ready to open"
          body={`Status is ${version.documentStatus}. The workspace opens when extraction finishes.`}
        />
      </div>
    )
  }
  if (kind === 'other') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title="No in-product viewer for this file type"
          body="Word documents open in the model editor. PDFs open as a read-only layout view."
        />
      </div>
    )
  }
  if (kind === 'pdf') {
    return (
      <PdfWorkspace
        documentId={documentId}
        filename={version.filename}
        layout={layout}
      />
    )
  }
  return (
    <DocxWorkspace
      documentId={documentId}
      versionId={version.id}
      matterId={version.matterId}
      filename={version.filename}
      layout={layout}
    />
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

  return (
    <WorkspaceShell layout={layout}>
      <WorkspaceRibbon>
        <PdfRibbon
          zoom={zoom}
          onZoom={setZoom}
          onExportText={() => {
            if (view.data) downloadPlainText(filename, view.data.text)
          }}
        />
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
