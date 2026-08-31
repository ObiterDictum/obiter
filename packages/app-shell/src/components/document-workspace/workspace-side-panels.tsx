import type { DocumentChangeWire, DocumentComment } from '@obiter/contracts'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentChangesPanel } from './changes-panel'
import { DocumentCommentsPanel } from './comments-panel'
import type { AuthorityHit } from '../../document-authorities'

export function WorkspaceSidePanels({
  commentsOpen,
  changesOpen,
  authoritiesOpen,
  comments,
  selectedParagraphId,
  selectedParagraphLength,
  commentsPending,
  commentsError,
  onCreateComment,
  onResolveComment,
  changes,
  changesPending,
  changesError,
  onDecideChange,
  authorities,
  onSelectAuthority,
}: {
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  comments: DocumentComment[]
  selectedParagraphId: string | null
  selectedParagraphLength: number
  commentsPending: boolean
  commentsError: string | null
  onCreateComment: (input: {
    body: string
    paragraphId: string
    endOffset: number
  }) => void
  onResolveComment: (commentId: string) => void
  changes: DocumentChangeWire[]
  changesPending: boolean
  changesError: string | null
  onDecideChange: (action: 'accept' | 'reject', changeId: string) => void
  authorities: AuthorityHit[]
  onSelectAuthority: (paragraphId: string) => void
}) {
  return (
    <>
      {commentsOpen ? (
        <div className="w-full rounded-md bg-surface p-4 lg:w-80">
          <DocumentCommentsPanel
            comments={comments}
            selectedParagraphId={selectedParagraphId}
            selectedParagraphLength={selectedParagraphLength}
            canEdit
            pending={commentsPending}
            error={commentsError}
            onCreate={onCreateComment}
            onResolve={onResolveComment}
          />
        </div>
      ) : null}
      {changesOpen ? (
        <div className="w-full rounded-md bg-surface p-4 lg:w-80">
          <DocumentChangesPanel
            changes={changes}
            pending={changesPending}
            error={changesError}
            onDecide={onDecideChange}
          />
        </div>
      ) : null}
      {authoritiesOpen ? (
        <div className="w-full rounded-md bg-surface p-4 lg:w-80">
          <DocumentAuthoritiesPanel
            citations={authorities}
            onSelect={onSelectAuthority}
          />
        </div>
      ) : null}
    </>
  )
}
