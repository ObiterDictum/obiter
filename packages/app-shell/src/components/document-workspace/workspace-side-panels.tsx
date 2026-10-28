import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentCommentReply,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { DockedPanel, type PanelPopout } from '@obiter/ui'
import type { ReactNode } from 'react'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentReviewPanel } from './changes-panel'
import { DocumentCommentsPanel } from './comments-panel'
import { DocumentInfoPanel } from './document-info-panel'
import { LegalChecksPanel } from './legal-checks-panel'
import { VerificationDock } from '../verification/verification-dock'
import type { ChangeReview } from './use-change-review'
import type { WorkspacePanel } from './use-workspace-panels'
import type { AuthorityHit } from '../../document-authorities'
import type { LegalChecksFocus } from './ribbon-types'
import type { checkCrossReferences } from '../../document-cross-reference-check'
import type { checkDefinedTerms } from '../../document-defined-terms'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import type { DocumentModelWire } from '@obiter/contracts'

/**
 * The panels docked beside the paper, one at a time. Each is non-modal: the
 * document stays visible and editable, so a reader can check a comment or a
 * citation and go straight back to the text without dismissing anything.
 */
export function WorkspaceSidePanels({
  panel,
  onClose,
  popout,
  info,
  comments,
  importedComments,
  orphanedReplies,
  commentTarget,
  currentUserId,
  canModerate,
  commentsPending,
  commentsError,
  onCreateComment,
  onReplyComment,
  onResolveComment,
  onReopenComment,
  onRevealCommentAnchor,
  changeReview,
  reviewComments,
  model,
  currentVersionNumber,
  onRevealReviewComment,
  authorities,
  onSelectAuthority,
  legalChecks,
  legalChecksFocus,
}: {
  panel: WorkspacePanel | null
  onClose: () => void
  /** The pop-out state of the panel being rendered. */
  popout: (panel: WorkspacePanel) => PanelPopout
  /** Absent outside the document route, where no detail was loaded. */
  info?: {
    document: MatterDocumentRecord
    versions: DocumentVersionRecord[]
    matterLink?: ReactNode
    onViewVersion?: (versionId: string) => void
  }
  comments: DocumentComment[]
  importedComments: DocumentImportedCommentThread[]
  orphanedReplies: DocumentCommentReply[]
  commentTarget: DocumentCommentAnchor | null
  currentUserId: string | undefined
  canModerate: boolean
  commentsPending: boolean
  commentsError: string | null
  onCreateComment: (body: string) => Promise<boolean>
  onReplyComment: (input: {
    parentId: string
    body: string
  }) => Promise<boolean>
  onResolveComment: (commentId: string) => void
  onReopenComment: (commentId: string) => void
  onRevealCommentAnchor: (anchor: DocumentCommentAnchor) => void
  /** The shared review state the chrome also uses; required with the panel. */
  changeReview: ChangeReview
  /** Comment threads, merged into the review list in document order. */
  reviewComments: {
    comments: DocumentComment[]
    importedComments: DocumentImportedCommentThread[]
  }
  model?: DocumentModelWire
  currentVersionNumber?: number
  onRevealReviewComment: (comment: DocumentComment) => void
  authorities: AuthorityHit[]
  onSelectAuthority: (paragraphId: string) => void
  /** The check derivations, or null while the model loads. */
  legalChecks: {
    references: ReturnType<typeof checkCrossReferences>
    terms: ReturnType<typeof checkDefinedTerms>
  } | null
  legalChecksFocus: LegalChecksFocus | null
}) {
  if (panel === null) return null
  if (panel === 'info') {
    if (!info) return null
    return (
      <DocumentInfoPanel
        open
        onClose={onClose}
        popout={popout('info')}
        document={info.document}
        versions={info.versions}
        matterLink={info.matterLink}
        onViewVersion={info.onViewVersion}
      />
    )
  }
  if (panel === 'verify') {
    return (
      <DockedPanel title="Verify" onClose={onClose} popout={popout('verify')}>
        <VerificationDock panel currentUserId={currentUserId} />
      </DockedPanel>
    )
  }
  if (panel === 'comments') {
    return (
      <DockedPanel title="Comments" onClose={onClose} popout={popout('comments')}>
        <DocumentCommentsPanel
          comments={comments}
          importedComments={importedComments}
          orphanedReplies={orphanedReplies}
          commentTarget={commentTarget}
          canEdit
          currentUserId={currentUserId}
          canModerate={canModerate}
          pending={commentsPending}
          error={commentsError}
          onCreate={onCreateComment}
          onReply={onReplyComment}
          onResolve={onResolveComment}
          onReopen={onReopenComment}
          onRevealAnchor={onRevealCommentAnchor}
        />
      </DockedPanel>
    )
  }
  if (panel === 'review') {
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
  }
  if (panel === 'authorities') {
    return (
      <DockedPanel title="Authorities" onClose={onClose} popout={popout('authorities')}>
        <DocumentAuthoritiesPanel
          citations={authorities}
          onSelect={onSelectAuthority}
        />
      </DockedPanel>
    )
  }
  return (
    <DockedPanel title="Legal checks" onClose={onClose} popout={popout('legal-checks')}>
      <LegalChecksPanel
        checks={legalChecks}
        focus={legalChecksFocus ?? 'terms'}
        onSelect={onSelectAuthority}
      />
    </DockedPanel>
  )
}
