import type { DocumentMarkingsWire, DocumentModelWire } from '@obiter/contracts'
import { ApiError } from '../../api'
import { useUpdateDocumentMarkings } from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import type { DocumentMarkingsToolbar } from './ribbon-types'
import type { useDocumentSave } from './use-document-save'

export function useDocumentMarkings({
  documentId,
  matterId,
  model,
  baseVersionId,
  trackChanges,
  save,
  onSaved,
  onNotice,
}: {
  documentId: string
  matterId: string
  model: DocumentModelWire | undefined
  baseVersionId: string
  trackChanges: boolean
  save: ReturnType<typeof useDocumentSave>
  onSaved: (versionId: string) => void
  onNotice: (message: string) => void
}): DocumentMarkingsToolbar | undefined {
  const update = useUpdateDocumentMarkings(documentId, matterId)
  if (!model) return undefined

  const status = save.saveState.status
  const unavailable =
    model.markings.unreadable === true
      ? 'The stored markings could not be read; marking this copy is disabled.'
      : update.isPending || status === 'saving'
        ? 'A save or marking is still being committed.'
        : status === 'blocked'
          ? 'The edit history is blocked; resolve it before marking.'
          : status === 'stale'
            ? 'The document changed on the server; reload before marking.'
            : status === 'failed'
              ? 'The last save failed; resolve it before marking.'
              : save.editsPending
                ? 'Save or discard unsaved edits before marking.'
                : null

  const commit = (markings: DocumentMarkingsWire) => {
    if (unavailable) return
    refocusCaretBeforeFlight()
    update.mutate(
      {
        baseVersionId,
        ...(trackChanges !== model.trackRevisions
          ? { trackRevisions: trackChanges }
          : {}),
        markings,
      },
      {
        onSuccess: (data) => onSaved(data.versionId),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'conflict_detected')
            save.markStale()
          else
            onNotice(
              error instanceof Error
                ? error.message
                : 'The marking could not be saved.',
            )
        },
      },
    )
  }
  const markings = model.markings
  const write = (
    patch: Partial<DocumentMarkingsWire>,
  ): DocumentMarkingsWire => ({
    documentKind: markings.documentKind,
    draft: markings.draft,
    privileged: markings.privileged,
    withoutPrejudice: markings.withoutPrejudice,
    ...patch,
  })
  return {
    markings,
    pending: update.isPending,
    unavailable: unavailable ?? undefined,
    onDocumentKind: (documentKind) => commit(write({ documentKind })),
    onToggleDraft: () => commit(write({ draft: !markings.draft })),
    onTogglePrivileged: () =>
      commit(write({ privileged: !markings.privileged })),
    onToggleWithoutPrejudice: () =>
      commit(write({ withoutPrejudice: !markings.withoutPrejudice })),
  }
}
