import { Button, EmptyState, Skeleton } from '@obiter/ui'
import { ApiError } from '../../api'
import type { AuthorityHit } from '../../document-authorities'
import type { CrossReferenceCheck } from '../../document-cross-reference-check'
import type { DefinedTermCheck } from '../../document-defined-terms'
import { RightSlotPortal, type DocumentPanelTab } from '../../right-slot-portal'
import { DocumentAuthoritiesPanel } from './authorities-panel'
import { DocumentCommentsPanel } from './comments-panel'
import { LegalChecksPanel } from './legal-checks-panel'
import type { WorkspaceCommentsPanelProps } from './use-workspace-comments'

export type PanelLoad<Ready = object> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | ({ status: 'ready' } & Ready)

type LegalChecks = { references: CrossReferenceCheck; terms: DefinedTermCheck }

export function PanelLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <p className="text-body text-muted">{label}</p>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

export function PanelError({
  title,
  error,
  fallback,
}: {
  title: string
  error: unknown
  fallback: string
}) {
  return (
    <EmptyState
      title={title}
      body={error instanceof ApiError ? error.message : fallback}
    />
  )
}

export function DocumentChecksTab({
  state,
  authorities,
  onSelect,
}: {
  state: PanelLoad<{ checks: LegalChecks }>
  authorities: readonly AuthorityHit[]
  onSelect: (paragraphId: string) => void
}) {
  if (state.status === 'loading') {
    return <PanelLoading label="Loading the document to check it…" />
  }
  if (state.status === 'error') {
    return (
      <PanelError
        title="Checks could not run"
        error={state.error}
        fallback="The document model could not be loaded, so nothing was checked."
      />
    )
  }
  const { terms, references } = state.checks
  if (
    terms.findings.length === 0 &&
    references.findings.length === 0 &&
    authorities.length === 0
  ) {
    return (
      <EmptyState
        title="No findings"
        body="Defined terms and cross-references check clean, and the document cites no authorities."
      />
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <LegalChecksPanel checks={state.checks} onSelect={onSelect} />
      <section className="flex flex-col gap-1">
        <h4 className="text-item text-ink">Authorities</h4>
        <DocumentAuthoritiesPanel citations={authorities} onSelect={onSelect} />
      </section>
    </div>
  )
}

export function DocumentCommentsTab({
  state,
  comments,
}: {
  state: PanelLoad
  comments: WorkspaceCommentsPanelProps
}) {
  if (state.status === 'loading') {
    return <PanelLoading label="Loading comments…" />
  }
  if (state.status === 'error') {
    return (
      <PanelError
        title="Comments could not be loaded"
        error={state.error}
        fallback="Reload the document to try again."
      />
    )
  }
  return (
    <DocumentCommentsPanel
      comments={comments.comments}
      importedComments={comments.importedComments}
      orphanedReplies={comments.orphanedReplies}
      commentTarget={comments.commentTarget}
      canEdit
      currentUserId={comments.currentUserId}
      canModerate={comments.canModerate}
      pending={comments.commentsPending}
      error={comments.commentsError}
      onCreate={comments.onCreateComment}
      onReply={comments.onReplyComment}
      onResolve={comments.onResolveComment}
      onReopen={comments.onReopenComment}
      deletableCommentIds={comments.deletableCommentIds}
      deletedComments={comments.deletedComments}
      onDelete={comments.onDeleteComment}
      onRestore={comments.onRestoreComment}
      onRevealAnchor={comments.onRevealCommentAnchor}
    />
  )
}

export function DocxRightSlotTabs({
  checks,
  authorities,
  onSelect,
  comments,
}: {
  checks: PanelLoad<{ checks: LegalChecks }>
  authorities: readonly AuthorityHit[]
  onSelect: (paragraphId: string) => void
  comments: { load: PanelLoad; props: WorkspaceCommentsPanelProps }
}) {
  return (
    <>
      <RightSlotPortal tab="checks">
        <DocumentChecksTab
          state={checks}
          authorities={authorities}
          onSelect={onSelect}
        />
      </RightSlotPortal>
      <RightSlotPortal tab="comments">
        <DocumentCommentsTab state={comments.load} comments={comments.props} />
      </RightSlotPortal>
    </>
  )
}

export type DocumentTabsNoticeKind =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'not-ready' }
  | { kind: 'not-word' }
  | { kind: 'historical'; versionNumber: number; onReturn: () => void }

const TAB_NAMES = { comments: 'Comments', checks: 'Checks' } as const

export function DocumentTabsNotice({
  notice,
  tab,
}: {
  notice: DocumentTabsNoticeKind
  tab: Exclude<DocumentPanelTab, 'history'>
}) {
  const name = TAB_NAMES[tab]
  switch (notice.kind) {
    case 'loading':
      return <PanelLoading label="Opening the document…" />
    case 'unavailable':
      return (
        <EmptyState
          title="This document could not be opened"
          body={`${name} appear once the document opens.`}
        />
      )
    case 'not-ready':
      return (
        <EmptyState
          title="The document is still being prepared"
          body={`${name} appear when extraction finishes.`}
        />
      )
    case 'not-word':
      return (
        <EmptyState
          title={`${name} need a Word document`}
          body="This document is read only. Comments and checks work on .docx files."
        />
      )
    case 'historical':
      return (
        <EmptyState
          title={`Viewing version ${String(notice.versionNumber)}`}
          body={`${name} follow the current version. This earlier version is read only.`}
          action={
            <Button variant="ghost" size="sm" onClick={notice.onReturn}>
              Back to the current version
            </Button>
          }
        />
      )
  }
}

export function DocumentTabsNotices({
  notice,
}: {
  notice: DocumentTabsNoticeKind
}) {
  return (
    <>
      <RightSlotPortal tab="comments">
        <DocumentTabsNotice notice={notice} tab="comments" />
      </RightSlotPortal>
      <RightSlotPortal tab="checks">
        <DocumentTabsNotice notice={notice} tab="checks" />
      </RightSlotPortal>
    </>
  )
}

type QueryLike = { isError: boolean; error: unknown }

export function queryLoad(query: QueryLike & { data: unknown }): PanelLoad {
  if (query.data !== undefined) return { status: 'ready' }
  return query.isError
    ? { status: 'error', error: query.error }
    : { status: 'loading' }
}

export function checksLoad(
  modelQuery: QueryLike,
  checks: LegalChecks | null,
): PanelLoad<{ checks: LegalChecks }> {
  if (checks) return { status: 'ready', checks }
  return modelQuery.isError
    ? { status: 'error', error: modelQuery.error }
    : { status: 'loading' }
}
