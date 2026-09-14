import { Button } from '@obiter/ui'
import {
  blockedSummary,
  type DocumentSave,
  type SaveState,
} from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'

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
      {drafts.staleDraft ? (
        <Banner
          tone="warning"
          body="Unsaved changes recorded against an earlier version of this document were not applied, because applying them to a newer version could corrupt it."
          actions={[
            {
              label: 'Discard unsaved changes',
              onAction: drafts.discardStaleDraft,
            },
          ]}
        />
      ) : null}
      {save.failure ? (
        <Banner
          tone="danger"
          body={save.failure}
          actions={[
            { label: 'Retry save', onAction: save.retry },
            { label: 'Reload and discard', onAction: save.reload },
          ]}
        />
      ) : null}
      {save.persistence === 'unavailable' && hasUnsavedWork(save) ? (
        <Banner
          tone="warning"
          body="This browser could not store a draft, so reloading or closing the tab would lose these unsaved changes."
        />
      ) : null}
      {blocked ? (
        <Banner
          tone="warning"
          body={blocked}
          actions={[
            { label: `Discard ${plural}`, onAction: save.discardBlocked },
          ]}
        />
      ) : null}
      {save.held.length > 0 ? (
        <Banner
          tone="warning"
          body={heldSummary(save)}
          actions={[
            {
              label: 'Discard held change',
              onAction: () =>
                save.discardHeld(save.held.map((item) => item.id)),
            },
          ]}
        />
      ) : null}
    </div>
  )
}

function hasUnsavedWork(save: DocumentSave) {
  return save.dirty || save.held.length > 0 || save.blocked.length > 0
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
      return 'Save failed — your work is not on the server'
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

function Banner({
  tone,
  body,
  actions = [],
}: {
  tone: 'info' | 'warning' | 'danger'
  body: string
  actions?: ReadonlyArray<{ label: string; onAction: () => void }>
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
      {actions.length > 0 ? (
        <div className="flex shrink-0 gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="secondary"
              size="sm"
              onClick={action.onAction}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
