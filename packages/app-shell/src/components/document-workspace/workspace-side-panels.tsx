import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentCommentReply,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentChangesPanel } from './changes-panel'
import { DocumentCommentsPanel } from './comments-panel'
import { LegalChecksPanel } from './legal-checks-panel'
import type { ChangeReview } from './use-change-review'
import type { AuthorityHit } from '../../document-authorities'
import type { LegalChecksFocus } from './ribbon-review'
import type { checkCrossReferences } from '../../document-cross-reference-check'
import type { checkDefinedTerms } from '../../document-defined-terms'

export function WorkspaceSidePanels({
  commentsOpen,
  changesOpen,
  authoritiesOpen,
  legalChecksOpen,
  legalChecks,
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
  authorities,
  onSelectAuthority,
}: {
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  /** The section the panel is focused on; null while it is closed. */
  legalChecksOpen: LegalChecksFocus | null
  /** The check derivations, or null while the model loads. */
  legalChecks: {
    references: ReturnType<typeof checkCrossReferences>
    terms: ReturnType<typeof checkDefinedTerms>
  } | null
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
  /** The shared review state the ribbon also uses; required with the panel. */
  changeReview: ChangeReview
  authorities: AuthorityHit[]
  onSelectAuthority: (paragraphId: string) => void
}) {
  return (
    <>
      {commentsOpen ? (
        <div
          data-print-hide
          className="w-full rounded-md bg-surface p-4 lg:w-80"
        >
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
        </div>
      ) : null}
      {changesOpen ? (
        <div
          data-print-hide
          className="w-full rounded-md bg-surface p-4 lg:w-80"
        >
          <DocumentChangesPanel review={changeReview} />
        </div>
      ) : null}
      {authoritiesOpen ? (
        <div
          data-print-hide
          className="w-full rounded-md bg-surface p-4 lg:w-80"
        >
          <DocumentAuthoritiesPanel
            citations={authorities}
            onSelect={onSelectAuthority}
          />
        </div>
      ) : null}
      {legalChecksOpen ? (
        <div
          data-print-hide
          className="w-full rounded-md bg-surface p-4 lg:w-80"
        >
          <LegalChecksPanel
            checks={legalChecks}
            focus={legalChecksOpen}
            onSelect={onSelectAuthority}
          />
        </div>
      ) : null}
    </>
  )
}
