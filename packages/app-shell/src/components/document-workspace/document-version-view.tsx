import { useMemo, useState } from 'react'
import {
  ArrowCounterClockwise,
  FileArrowDown,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react'
import { Badge, Button, EmptyState } from '@obiter/ui'
import type { DocumentModelWire } from '@obiter/contracts'
import { downloadBlob } from '../../document-edits'
import { workspaceKind } from '../../document-kind'
import { layoutDocument } from '../../document-page-engine'
import { documentImagePartNames } from '../../document-page-media'
import { pageReferenceMap } from '../../document-page-references'
import { documentDefaultFace } from '../../document-page-style'
import {
  fetchDocumentDownload,
  useDocumentImageUrls,
  useDocumentModel,
  useDocumentPdfView,
  useDocumentText,
} from '../../document-workspace-api'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentDesk, DocumentPage } from './document-page'
import { DocumentModelPage } from './model-view'
import { DocumentPdfPages } from './pdf-view'
import { IconButton, ToolbarGroup } from './ribbon-primitives'
import {
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
} from './workspace-chrome'

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 25

/**
 * A stored, non-current version rendered read-only. Nothing here drafts,
 * saves, merges or heartbeats — the component owns no edit state, so a
 * historical view can never write into the version it displays nor into the
 * current one. Returning to the current version is the caller's `onExit`.
 */
export function DocumentVersionView({
  documentId,
  version,
  onExit,
}: {
  documentId: string
  /** The selected version's metadata from the document detail query. */
  version: DocumentVersionRecord
  onExit: () => void
}) {
  const kind = workspaceKind(version.fileType)
  const [zoom, setZoom] = useState(100)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const ribbon = (
    <WorkspaceRibbon>
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2"
        role="toolbar"
        aria-label="Version viewer tools"
      >
        <Badge tone="info">Version {version.versionNumber}</Badge>
        <span className="truncate text-sm font-medium text-ink">
          {version.filename}
        </span>
        <span className="text-xs text-muted">Read only</span>
        <span className="flex-1" />
        {kind !== 'other' ? (
          <ToolbarGroup label="Zoom">
            <IconButton
              label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((value) => value - ZOOM_STEP)}
              icon={<MagnifyingGlassMinus size={16} aria-hidden />}
            />
            <span className="w-10 text-center text-xs text-muted">{zoom}%</span>
            <IconButton
              label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((value) => value + ZOOM_STEP)}
              icon={<MagnifyingGlassPlus size={16} aria-hidden />}
            />
          </ToolbarGroup>
        ) : null}
        <ToolbarGroup label="File">
          <IconButton
            label="Download this version"
            onClick={() => {
              setDownloadError(null)
              void fetchDocumentDownload(documentId, version.id)
                .then((blob) => downloadBlob(version.filename, blob))
                .catch((caught: unknown) =>
                  setDownloadError(
                    caught instanceof Error
                      ? caught.message
                      : 'Download failed.',
                  ),
                )
            }}
            icon={<FileArrowDown size={16} aria-hidden />}
          />
        </ToolbarGroup>
        <Button
          variant="secondary"
          size="sm"
          onClick={onExit}
          className="gap-1.5"
        >
          <ArrowCounterClockwise size={14} aria-hidden />
          Back to current version
        </Button>
      </div>
      {downloadError ? (
        <p className="px-3 pb-2 text-sm text-danger" role="status">
          {downloadError}
        </p>
      ) : null}
    </WorkspaceRibbon>
  )

  return (
    <WorkspaceShell layout="page">
      {ribbon}
      {kind === 'docx' ? (
        <HistoricalDocxPages
          documentId={documentId}
          versionId={version.id}
          zoom={zoom}
        />
      ) : kind === 'pdf' ? (
        <HistoricalPdfPages
          documentId={documentId}
          versionId={version.id}
          zoom={zoom}
        />
      ) : kind === 'txt' ? (
        <HistoricalText documentId={documentId} versionId={version.id} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="No in-product viewer for this file type"
            body="This version can be downloaded, but this file type has no page or text view."
          />
        </div>
      )}
    </WorkspaceShell>
  )
}

/**
 * The stored model paginated once and painted with `editing` unset: clicks,
 * caret, selection and margin editing are all inert, so the pages are the
 * version's content exactly as stored.
 */
function HistoricalDocxPages({
  documentId,
  versionId,
  zoom,
}: {
  documentId: string
  versionId: string
  zoom: number
}) {
  const modelQuery = useDocumentModel(documentId, { versionId })
  const model = modelQuery.data?.model
  return (
    <>
      {modelQuery.isLoading ? (
        <LoadingBlock label="Loading version" />
      ) : modelQuery.isError || !model ? (
        <QueryError
          error={modelQuery.error}
          fallback="This version could not be loaded."
        />
      ) : (
        <DocumentDesk>
          <ReadOnlyPages
            model={model}
            documentId={documentId}
            versionId={versionId}
            zoom={zoom}
          />
        </DocumentDesk>
      )}
    </>
  )
}

function ReadOnlyPages({
  model,
  documentId,
  versionId,
  zoom,
}: {
  model: DocumentModelWire
  documentId: string
  versionId: string
  zoom: number
}) {
  const pages = useMemo(() => layoutDocument(model), [model])
  const imageParts = useMemo(() => documentImagePartNames(model), [model])
  const imageUrls = useDocumentImageUrls(documentId, imageParts, versionId)
  const pageReferences = useMemo(
    () => pageReferenceMap(model, pages),
    [model, pages],
  )
  const fontFamily = documentDefaultFace(model.styles).fontFamily

  return (
    <div className="mx-auto flex w-max max-w-full flex-col items-start gap-6">
      {pages.map((laid, index) => (
        <DocumentPage
          key={`page-${index + 1}`}
          zoom={zoom}
          width={laid.box.widthPx}
          height={laid.box.heightPx}
          fontFamily={fontFamily}
        >
          <DocumentModelPage
            model={model}
            selectedParagraphId={null}
            onSelectParagraph={() => undefined}
            imageUrls={imageUrls}
            pageBlocks={laid.blocks}
            pageFloats={laid.floats}
            pageTextBoxes={laid.textBoxes}
            pageLayout={laid}
            pageNumber={index + 1}
            pageReferences={pageReferences}
          />
        </DocumentPage>
      ))}
    </div>
  )
}

function HistoricalPdfPages({
  documentId,
  versionId,
  zoom,
}: {
  documentId: string
  versionId: string
  zoom: number
}) {
  const view = useDocumentPdfView(documentId, { versionId })
  const [pageIndex, setPageIndex] = useState(0)

  return (
    <>
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
    </>
  )
}

function HistoricalText({
  documentId,
  versionId,
}: {
  documentId: string
  versionId: string
}) {
  const textQuery = useDocumentText(documentId, { versionId })

  return (
    <>
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
    </>
  )
}
