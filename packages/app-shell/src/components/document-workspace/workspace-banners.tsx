import { DocumentSaveBanners } from './save-banners'
import { ConflictBanner } from './workspace-chrome'
import type { useDocumentSave } from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'

/**
 * The ribbon's status strip: save state, the stale-version conflict, the
 * remote-edit conflict, the transient notice, and the off-screen selection
 * announcement. Extracted from `docx-workspace.tsx`, which is at the source
 * ceiling; the workspace owns the state and the reload/caret wrappers.
 */
export function WorkspaceBanners({
  save,
  drafts,
  remoteChange,
  transientNotice,
  selectionNotice,
  onReload,
}: {
  save: ReturnType<typeof useDocumentSave>
  drafts: WorkspaceDrafts
  remoteChange: boolean
  transientNotice: string | null
  selectionNotice: string
  onReload: () => void
}) {
  return (
    <>
      <DocumentSaveBanners save={save} drafts={drafts} />
      {save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="The document has changed since editing began."
            actionLabel="Reload"
            onAction={onReload}
          />
        </div>
      ) : null}
      {remoteChange && save.dirty && !save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="A colleague saved a newer version. Reload before saving, or save to merge disjoint edits."
            actionLabel="Reload"
            onAction={onReload}
          />
        </div>
      ) : null}
      {transientNotice ? (
        <p className="px-3 pb-2 text-sm text-ink" role="status">
          {transientNotice}
        </p>
      ) : null}
      {/* A document selection is custom rather than the textarea's own, so its
          state and any refusal is announced rather than only painted. No
          role="status" so the transient banner stays the only status region. */}
      <p className="sr-only" aria-live="polite" data-selection-status>
        {selectionNotice}
      </p>
    </>
  )
}
