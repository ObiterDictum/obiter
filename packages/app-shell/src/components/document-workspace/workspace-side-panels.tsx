import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentCommentReply,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentChangesPanel } from './changes-panel'
import { DocumentCommentsPanel } from './comments-panel'
import type { ChangeReview } from './use-change-review'
import type { AuthorityHit } from '../../document-authorities'

export function WorkspaceSidePanels({
  commentsOpen,
  changesOpen,
  authoritiesOpen,
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
    </>
  )
}
