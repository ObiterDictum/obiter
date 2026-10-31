import { DocumentSaveBanners } from './save-banners'
import { ConflictBanner } from './workspace-chrome'
import type { ChromeSave } from './use-document-save'
import type { ChromeDrafts } from './use-workspace-drafts'

export function WorkspaceBanners({
  save,
  drafts,
  remoteChange,
  transientNotice,
  selectionNotice,
  onReload,
}: {
  save: ChromeSave
  drafts: ChromeDrafts
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

      <p className="sr-only" aria-live="polite" data-selection-status>
        {selectionNotice}
      </p>
    </>
  )
}
