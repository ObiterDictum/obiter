import { Button } from '@obiter/ui'
import type { ReactNode } from 'react'
import {
  blockedSummary,
  type DocumentSave,
  type SaveState,
} from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import { DiscardWorkDialog } from './discard-work-dialog'

/**
 * Everything the workspace must disclose about work that is not on the server:
 * a restored draft, a draft from another version, a change that cannot be
 * addressed, a change the server rejected, or a failed request. Each carries
 * the action that recovers from it, and none of them deletes content silently.
 */
export function DocumentSaveBanners({
  save,
  drafts,
}: {
  save: DocumentSave
  drafts: WorkspaceDrafts
}) {
  const blocked = blockedSummary(save.blocked)
  const plural = save.blocked.length === 1 ? 'change' : 'changes'
  return (
    <div className="flex flex-col gap-2 px-3 pb-2">
      <p
        className="text-xs text-muted"
        data-save-state={save.saveState.status}
        aria-live="polite"
      >
        {saveStatusLabel(save.saveState)}
      </p>
      {drafts.restored && save.dirty ? (
        <Banner
          tone="info"
          body="Unsaved changes were restored from this browser. They have not been saved to the server yet."
        />
      ) : null}
      {drafts.recoverable.filter((item) => item.status === 'active').length >
      0 ? (
        <Banner
          tone="warning"
          body="More than one unsaved draft exists for this document. Nothing was applied automatically. Restore one or discard the ones you do not need."
        >
          {drafts.recoverable
            .filter((item) => item.status === 'active')
            .map((item) => (
              <div key={item.draftId} className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => drafts.restoreRecoverable(item.draftId)}
                >
                  Restore draft from {formatStamp(item.updatedAt)}
                </Button>
                <DiscardWorkDialog
                  triggerLabel="Discard this draft"
                  title="Discard this unsaved draft?"
                  body="This deletes one stored draft for this document in this browser. Other drafts and the server copy are unchanged."
                  confirmLabel="Discard this draft"
                  onConfirm={() => drafts.discardRecoverable(item.draftId)}
                />
              </div>
            ))}
        </Banner>
      ) : null}
      {drafts.staleDraft ? (
        <Banner
          tone="warning"
          body="Unsaved changes recorded against an earlier version of this document were not applied, because applying them to a newer version could corrupt it."
        >
          <DiscardWorkDialog
            triggerLabel="Discard unsaved changes"
            title="Discard stored work from an earlier version?"
            body="This deletes parked unsaved changes for earlier versions of this document in this browser. Current unsaved work stays. The server copy is unchanged."
            confirmLabel="Discard parked changes"
            onConfirm={drafts.discardStaleDraft}
          />
        </Banner>
      ) : null}
      {save.failure ? (
        <Banner tone="danger" body={save.failure}>
          <Button variant="secondary" size="sm" onClick={save.retry}>
            Retry save
          </Button>
          <DiscardWorkDialog
            triggerLabel="Reload and discard"
            title="Discard all unsaved work and reload?"
            body="This discards active edits, held rejected changes, and stored drafts for this document in this browser. The server copy is unchanged."
            confirmLabel="Discard unsaved work"
            onConfirm={save.reload}
          />
        </Banner>
      ) : null}
      {save.persistence === 'unavailable' && hasUnsavedWork(save, drafts) ? (
        <Banner
          tone="warning"
          body="This browser could not store a draft, so reloading or closing the tab would lose these unsaved changes."
        />
      ) : null}
      {blocked ? (
        <Banner tone="warning" body={blocked}>
          <DiscardWorkDialog
            triggerLabel={`Discard ${plural}`}
            title={`Discard ${plural} that cannot be sent?`}
            body={`This deletes the ${plural} that no longer match the document. Other unsaved work stays. The server copy is unchanged.`}
            confirmLabel={`Discard ${plural}`}
            onConfirm={save.discardBlocked}
          />
        </Banner>
      ) : null}
      {save.held.length > 0 ? (
        <Banner tone="warning" body={heldSummary(save)}>
          <DiscardWorkDialog
            triggerLabel="Discard held change"
            title="Discard the held rejected change?"
            body="This deletes the change the server rejected, which is held here and not being resent. Other unsaved work stays. The server copy is unchanged."
            confirmLabel="Discard held change"
            onConfirm={() => save.discardHeld(save.held.map((item) => item.id))}
          />
        </Banner>
      ) : null}
    </div>
  )
}

function hasUnsavedWork(save: DocumentSave, drafts: WorkspaceDrafts) {
  return (
    save.dirty ||
    save.held.length > 0 ||
    save.blocked.length > 0 ||
    drafts.recoverable.length > 0
  )
}

function saveStatusLabel(state: SaveState) {
  switch (state.status) {
    case 'saved':
      return 'All changes saved'
    case 'unsaved':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving…'
    case 'failed':
      return 'Save failed: your work is not on the server'
    case 'stale':
      return 'The document changed on the server; reload before saving'
  }
}

function heldSummary(save: DocumentSave) {
  const first = save.held[0]
  if (save.held.length === 1) {
    return `The server rejected ${first?.label ?? 'a change'}. It is held here and has not blocked the rest of your work. Saving will not resend it.`
  }
  return `The server rejected ${String(save.held.length)} changes. They are held here and have not blocked the rest of your work.`
}

function formatStamp(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'an earlier session'
  return new Date(parsed).toLocaleString()
}

function Banner({
  tone,
  body,
  children,
}: {
  tone: 'info' | 'warning' | 'danger'
  body: string
  children?: ReactNode
}) {
  const background =
    tone === 'danger'
      ? 'bg-danger/15'
      : tone === 'warning'
        ? 'bg-warning/15'
        : 'bg-raised'
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 ${background}`}
      role="status"
    >
      <p className="text-sm text-ink">{body}</p>
      {children ? (
        <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
      ) : null}
    </div>
  )
}
