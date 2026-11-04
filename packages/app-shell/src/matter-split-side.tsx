import { Skeleton } from '@obiter/ui'
import { ArrowsLeftRight, X } from '@obiter/ui/icons'
import { useMemo, useRef } from 'react'
import {
  DocumentEditorHeader,
  readOnlyHeaderState,
} from './components/document-workspace/document-editor-header'
import { useElementWidth } from './components/document-workspace/use-element-width'
import { documentImagePartNames } from './document-page-media'
import { layoutDocumentPages, StaticDocumentPages } from './document-render'
import {
  useDocumentModel,
  useDocumentImageUrls,
} from './document-workspace-api'
import { useDocument } from './documents'
import { useMatterTabs } from './matter-tabs-state'
import { useSplitScale } from './matter-split-scale'

const PAPER_WIDTH = 794

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
  const document = useDocument(documentId ?? '')
  const version = document.data?.document.currentVersion ?? null
  const modelQuery = useDocumentModel(documentId ?? '', {
    versionId: version?.id,
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
  const paneRef = useRef<HTMLElement>(null)
  const width = useElementWidth(paneRef)
  const split = useSplitScale()
  const zoom =
    split?.pageZoom ??
    (width === null
      ? 100
      : Math.min(
          100,
          Math.max(35, Math.floor(((width - 32) / PAPER_WIDTH) * 100)),
        ))

  return (
    <section
      ref={paneRef}
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
      <div className="flex min-h-0 flex-1 flex-col">
        {!documentId ? (
          <p className="px-4 py-6 text-meta text-muted">
            Open a document to the side to compare it here.
          </p>
        ) : document.isPending || modelQuery.isLoading ? (
          <Skeleton className="m-4 h-64" />
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
