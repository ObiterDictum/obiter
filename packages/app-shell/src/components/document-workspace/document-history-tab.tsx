import { RestoreVersionButton } from './restore-version-button'
import { Badge, EmptyState, cn } from '@obiter/ui'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import { RightSlotPortal } from '../../right-slot-portal'
import { VersionSummary } from './document-info-panel'
import { PanelError, PanelLoading, type PanelLoad } from './document-right-slot'

type HistoryLoad = PanelLoad<{
  document: MatterDocumentRecord
  versions: readonly DocumentVersionRecord[]
}>

export function DocumentHistoryTab({
  state,
  viewingVersionId,
  onSelect,
  onRestore,
  restoreDisabledReason,
}: {
  state: HistoryLoad
  viewingVersionId: string | undefined
  onSelect: (versionId: string | undefined) => void
  onRestore?: (versionId: string) => void
  restoreDisabledReason?: string
}) {
  if (state.status === 'loading') {
    return <PanelLoading label="Loading versions…" />
  }
  if (state.status === 'error') {
    return (
      <PanelError
        title="Versions could not be loaded"
        error={state.error}
        fallback="Reload the document to try again."
      />
    )
  }
  if (state.versions.length === 0) {
    return (
      <EmptyState
        title="No saved versions"
        body="Each save locks a new version here."
      />
    )
  }
  const currentId = state.document.currentVersionId
  const shownId = viewingVersionId ?? currentId
  const viewing = state.versions.find(
    (version) => version.id === viewingVersionId && version.id !== currentId,
  )
  const newestFirst = [...state.versions].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-subtle">
        {viewing
          ? `Viewing version ${String(viewing.versionNumber)} read only. Choose the current version to keep editing.`
          : 'Every save locks a version. Choose one to read it without changing the document.'}
      </p>
      <ul className="flex flex-col" aria-label="Saved versions">
        {newestFirst.map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-current={version.id === shownId ? 'true' : undefined}
              disabled={version.documentStatus !== 'ready'}
              onClick={() =>
                onSelect(version.id === currentId ? undefined : version.id)
              }
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left',
                'hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                'aria-[current=true]:bg-fill',
              )}
            >
              <VersionSummary version={version} currentVersionId={currentId} />
              {version.documentStatus === 'ready' ? null : (
                <Badge
                  tone={version.documentStatus === 'failed' ? 'danger' : 'info'}
                >
                  {version.documentStatus}
                </Badge>
              )}
            </button>
            {version.id !== currentId &&
            onRestore &&
            version.documentStatus === 'ready' ? (
              <RestoreVersionButton
                versionNumber={version.versionNumber}
                onRestore={() => onRestore(version.id)}
                disabledReason={restoreDisabledReason}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DocumentHistoryPortal(
  props: Parameters<typeof DocumentHistoryTab>[0],
) {
  return (
    <RightSlotPortal tab="history">
      <DocumentHistoryTab {...props} />
    </RightSlotPortal>
  )
}
