import type {
  DocumentComment,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { DockedPanel, type PanelPopout } from '@obiter/ui'
import { memo, type ReactNode } from 'react'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentReviewPanel } from './changes-panel'
import { DocumentInfoPanel } from './document-info-panel'
import { VerificationDock } from '../verification/verification-dock'
import type { ChangeReview } from './use-change-review'
import type { WorkspacePanel } from './use-workspace-panels'
import type { AuthorityHit } from '../../document-authorities'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import type { DocumentModelWire } from '@obiter/contracts'

function WorkspaceSidePanelsInner({
  panel,
  onClose,
  popout,
  info,
  currentUserId,
  changeReview,
  reviewComments,
  model,
  currentVersionNumber,
  onRevealReviewComment,
  authorities,
  onSelectAuthority,
}: {
  panel: WorkspacePanel | null
  onClose: () => void
  popout: (panel: WorkspacePanel) => PanelPopout
  info?: {
    document: MatterDocumentRecord
    versions: DocumentVersionRecord[]
    matterLink?: ReactNode
    onViewVersion?: (versionId: string) => void
  }
  currentUserId: string | undefined
  changeReview: ChangeReview
  reviewComments: {
    comments: DocumentComment[]
    importedComments: DocumentImportedCommentThread[]
  }
  model?: DocumentModelWire
  currentVersionNumber?: number
  onRevealReviewComment: (comment: DocumentComment) => void
  authorities: AuthorityHit[]
  onSelectAuthority: (paragraphId: string) => void
}) {
  switch (panel) {
    case null:
      return null
    case 'info':
      return info ? (
        <DocumentInfoPanel
          open
          onClose={onClose}
          popout={popout('info')}
          document={info.document}
          versions={info.versions}
          matterLink={info.matterLink}
          onViewVersion={info.onViewVersion}
        />
      ) : null
    case 'verify':
      return (
        <DockedPanel title="Verify" onClose={onClose} popout={popout('verify')}>
          <VerificationDock panel currentUserId={currentUserId} />
        </DockedPanel>
      )
    case 'review':
      return (
        <DocumentReviewPanel
          review={changeReview}
          comments={reviewComments.comments}
          importedComments={reviewComments.importedComments}
          model={model}
          currentVersionNumber={currentVersionNumber}
          onRevealComment={onRevealReviewComment}
          onClose={onClose}
          popout={popout('review')}
        />
      )
    case 'authorities':
      return (
        <DockedPanel
          title="Authorities"
          onClose={onClose}
          popout={popout('authorities')}
        >
          <DocumentAuthoritiesPanel
            citations={authorities}
            onSelect={onSelectAuthority}
          />
        </DockedPanel>
      )
  }
}

export const WorkspaceSidePanels = memo(
  WorkspaceSidePanelsInner,
  (prev, next) => prev.panel === null && next.panel === null,
)
