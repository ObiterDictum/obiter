import { Suspense, lazy, type ReactNode, type RefObject } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import type { DocumentOutlineEntry } from '../../document-outline'
import type { RulerContext } from '../../document-ruler'
import type { WorkspaceCommentsPanelProps } from './use-workspace-comments'
import type { ChangeReview } from './use-change-review'
import type { WorkspacePanel } from './use-workspace-panels'
import type { AuthorityHit } from '../../document-authorities'
import { DocxDesk } from './docx-desk'
import { BulkDecisionDialog } from './bulk-decision-dialog'
import { DocxModelPages } from './docx-model-pages'
import { WorkspaceSidePanels } from './workspace-side-panels'
const DocumentCompareRedline = lazy(() =>
  import('./document-compare-redline').then((module) => ({
    default: module.DocumentCompareRedline,
  })),
)

type ModelPagesProps = Omit<
  Parameters<typeof DocxModelPages>[0],
  'onExitMarginEditing' | 'onOpenNoteEditing'
>

export function DocxWorkspaceDesk({
  compareOpen,
  onCloseCompare,
  documentId,
  pages,
  zoom,
  navOpen,
  outline,
  activeParagraphId,
  onSelectOutline,
  onCloseNav,
  columnRef,
  spelling,
  rulerOn,
  ruler,
  paperWidth,
  onExitMarginEditing,
  onOpenNoteEditing,
  panel,
  onClosePanel,
  popout,
  documentRecord,
  versions,
  matterLink,
  onViewVersion,
  comments,
  changeReview,
  currentVersionNumber,
  authorities,
  onSelectAuthority,
}: {
  compareOpen: boolean
  onCloseCompare: () => void
  documentId: string
  pages: ModelPagesProps
  zoom: number
  navOpen: boolean
  outline: readonly DocumentOutlineEntry[]
  activeParagraphId: string | null
  onSelectOutline: (paragraphId: string) => void
  onCloseNav: () => void
  columnRef: RefObject<HTMLDivElement | null>
  spelling: boolean
  rulerOn: boolean
  ruler: RulerContext | undefined
  paperWidth: number | null
  onExitMarginEditing: () => void
  onOpenNoteEditing: (paragraphId: string) => void
  panel: WorkspacePanel | null
  onClosePanel: () => void
  popout: Parameters<typeof WorkspaceSidePanels>[0]['popout']
  documentRecord?: MatterDocumentRecord
  versions: DocumentVersionRecord[]
  matterLink?: ReactNode
  onViewVersion?: (versionId: string) => void
  comments: WorkspaceCommentsPanelProps
  changeReview: ChangeReview
  currentVersionNumber?: number
  authorities: AuthorityHit[]
  onSelectAuthority: (paragraphId: string) => void
}) {
  const model: DocumentModelWire = pages.model
  const bulkDialog = (
    <BulkDecisionDialog
      review={changeReview}
      versionNumber={currentVersionNumber}
    />
  )
  if (compareOpen) {
    return (
      <>
        <Suspense
          fallback={
            <div className="p-6 text-body text-muted" aria-busy="true">
              Opening the comparison…
            </div>
          }
        >
          <DocumentCompareRedline
            documentId={documentId}
            versions={versions}
            onClose={onCloseCompare}
          />
        </Suspense>
        {bulkDialog}
      </>
    )
  }
  return (
    <>
      <DocxDesk
        model={model}
        navOpen={navOpen}
        outline={outline}
        activeParagraphId={activeParagraphId}
        onSelectOutline={onSelectOutline}
        onCloseNav={onCloseNav}
        columnRef={columnRef}
        spelling={spelling}
        rulerOn={rulerOn}
        ruler={ruler}
        zoom={zoom}
        paperWidth={paperWidth}
        pages={
          <DocxModelPages
            {...pages}
            onExitMarginEditing={onExitMarginEditing}
            onOpenNoteEditing={onOpenNoteEditing}
          />
        }
        sidePanels={
          <WorkspaceSidePanels
            panel={panel}
            onClose={onClosePanel}
            popout={popout}
            info={
              documentRecord
                ? {
                    document: documentRecord,
                    versions,
                    matterLink,
                    onViewVersion,
                  }
                : undefined
            }
            currentUserId={comments.currentUserId}
            changeReview={changeReview}
            reviewComments={{
              comments: comments.comments,
              importedComments: comments.importedComments,
            }}
            model={model}
            currentVersionNumber={currentVersionNumber}
            onRevealReviewComment={(comment) =>
              comments.onRevealCommentAnchor(comment.anchor)
            }
            authorities={authorities}
            onSelectAuthority={onSelectAuthority}
          />
        }
      />
      {bulkDialog}
    </>
  )
}
