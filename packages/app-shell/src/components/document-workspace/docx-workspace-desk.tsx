import type { ReactNode, RefObject } from 'react'
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
import type { LegalChecksFocus } from './ribbon-types'
import type { AuthorityHit } from '../../document-authorities'
import { DocxDesk } from './docx-desk'
import { DocxModelPages } from './docx-model-pages'
import { WorkspaceSidePanels } from './workspace-side-panels'
import { DocumentCompareRedline } from './document-compare-redline'

type ModelPagesProps = Omit<
  Parameters<typeof DocxModelPages>[0],
  'onExitMarginEditing' | 'onOpenNoteEditing'
>

/**
 * The desk half of the DOCX workspace: the pages, the ruler, the navigation
 * pane and the docked panels. Extracted so `docx-workspace.tsx` keeps to the
 * request and review state it owns; every value here is one the workspace
 * already derived, and nothing in this file decides behaviour.
 */
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
  onExitMarginEditing,
  onOpenNoteEditing,
  panel,
  onClosePanel,
  popout,
  legalChecksFocus,
  documentRecord,
  versions,
  matterLink,
  onViewVersion,
  comments,
  changeReview,
  currentVersionNumber,
  authorities,
  legalChecks,
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
  onExitMarginEditing: () => void
  onOpenNoteEditing: (paragraphId: string) => void
  panel: WorkspacePanel | null
  onClosePanel: () => void
  popout: Parameters<typeof WorkspaceSidePanels>[0]['popout']
  legalChecksFocus: LegalChecksFocus | null
  documentRecord?: MatterDocumentRecord
  versions: DocumentVersionRecord[]
  matterLink?: ReactNode
  onViewVersion?: (versionId: string) => void
  comments: WorkspaceCommentsPanelProps
  changeReview: ChangeReview
  currentVersionNumber?: number
  authorities: AuthorityHit[]
  legalChecks: Parameters<typeof WorkspaceSidePanels>[0]['legalChecks']
  onSelectAuthority: (paragraphId: string) => void
}) {
  const model: DocumentModelWire = pages.model
  if (compareOpen) {
    return (
      <DocumentCompareRedline
        documentId={documentId}
        versions={versions}
        onClose={onCloseCompare}
      />
    )
  }
  return (
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
          legalChecksFocus={legalChecksFocus}
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
          {...comments}
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
          legalChecks={legalChecks}
          onSelectAuthority={onSelectAuthority}
        />
      }
    />
  )
}
