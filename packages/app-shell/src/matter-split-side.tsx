import { Skeleton } from '@obiter/ui'
import { ArrowsLeftRight, X } from '@obiter/ui/icons'
import { useMemo } from 'react'
import {
  DocumentEditorHeader,
  readOnlyHeaderState,
} from './components/document-workspace/document-editor-header'
import {
  HistoricalPdfPages,
  HistoricalText,
} from './components/document-workspace/document-version-view'
import { workspaceKind } from './document-kind'
import { documentImagePartNames } from './document-page-media'
import { layoutDocumentPages, StaticDocumentPages } from './document-render'
import {
  useDocumentModel,
  useDocumentImageUrls,
} from './document-workspace-api'
import { useDocument } from './documents'
import { useMatterTabs } from './matter-tabs-state'
import { useSplitScale } from './matter-split-scale'

export function MatterSplitSide({
  sideId,
  onClose,
}: {
  sideId: string
  onClose: () => void
}) {
  const { tabs, swapSides } = useMatterTabs()
  const tab = tabs.find((item) => item.id === sideId)
  const documentId = tab?.kind === 'document' ? tab.target : null
  const document = useDocument(documentId ?? '', {
    enabled: documentId !== null,
  })
  const version = document.data?.document.currentVersion ?? null
  const kind = version ? workspaceKind(version.fileType) : null
  const modelQuery = useDocumentModel(documentId ?? '', {
    versionId: version?.id,
    enabled: kind === 'docx',
  })
  const model = modelQuery.data?.model
  const pages = useMemo(
    () => (model ? layoutDocumentPages(model) : []),
    [model],
  )
  const parts = useMemo(
    () => (model ? documentImagePartNames(model) : []),
    [model],
  )
  const imageUrls = useDocumentImageUrls(documentId ?? '', parts, version?.id)
  const split = useSplitScale()
  const zoom = split?.pageZoom ?? 100
  const ribbonHeight = split?.ribbonHeight ?? 0

  return (
    <section
      aria-label={tab ? `${tab.title}, read only` : 'Split view'}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line bg-raised"
    >
      <DocumentEditorHeader
        filename={version?.filename ?? tab?.title ?? 'Document'}
        state={readOnlyHeaderState(
          `version ${String(version?.versionNumber ?? 1)}`,
        )}
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Swap sides"
              title="Make this the document you edit"
              onClick={swapSides}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowsLeftRight size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Close split view"
              onClick={onClose}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        }
      />
      {ribbonHeight > 0 ? (
        <div
          aria-hidden
          data-split-ribbon-spacer
          className="shrink-0"
          style={{ height: ribbonHeight }}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {!documentId ? (
          <p className="px-4 py-6 text-meta text-muted">
            Open a document to the side to compare it here.
          </p>
        ) : document.isPending || modelQuery.isLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : version && kind === 'pdf' ? (
          <HistoricalPdfPages
            documentId={documentId}
            versionId={version.id}
            zoom={zoom}
          />
        ) : version && kind === 'txt' ? (
          <HistoricalText documentId={documentId} versionId={version.id} />
        ) : !model ? (
          <p className="px-4 py-6 text-meta text-muted">
            This document has no readable version yet.
          </p>
        ) : (
          <StaticDocumentPages
            model={model}
            pages={pages}
            imageUrls={imageUrls}
            zoom={zoom}
          />
        )}
      </div>
    </section>
  )
}
