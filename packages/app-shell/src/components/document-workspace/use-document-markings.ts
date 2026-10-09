import type { DocumentMarkingsWire, DocumentModelWire } from '@obiter/contracts'
import { ApiError } from '../../api'
import { useUpdateDocumentMarkings } from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import type { DocumentMarkingsToolbar } from './ribbon-types'
import type { useDocumentSave } from './use-document-save'

/**
 * The Layout ribbon's classification controls. A marking change commits a new
 * immutable version server-side (`document.markings`), so it shares the save
 * state machine's barriers with tracked-change decisions: unsaved, blocked,
 * stale or failed work names its reason on the disabled controls rather than
 * landing a write against the wrong base. The stored kind is passed through
 * verbatim — a kind this ribbon does not list still shows and survives a flag
 * toggle, because the wire carries it as a plain string.
 */
export function useDocumentMarkings({
  documentId,
  matterId,
  model,
  baseVersionId,
  save,
  onSaved,
  onNotice,
}: {
  documentId: string
  matterId: string
  model: DocumentModelWire | undefined
  baseVersionId: string
  save: ReturnType<typeof useDocumentSave>
  onSaved: (versionId: string) => void
  onNotice: (message: string) => void
}): DocumentMarkingsToolbar | undefined {
  const update = useUpdateDocumentMarkings(documentId, matterId)
  if (!model) return undefined

  const status = save.saveState.status
  const unavailable =
    update.isPending || status === 'saving'
      ? 'A save or marking is still being committed.'
      : status === 'blocked'
        ? 'The edit history is blocked; resolve it before marking.'
        : status === 'stale'
          ? 'The document changed on the server; reload before marking.'
          : status === 'failed'
            ? 'The last save failed; resolve it before marking.'
            : status === 'unsaved'
              ? 'Save or discard unsaved edits before marking.'
              : null

  const commit = (markings: DocumentMarkingsWire) => {
    if (unavailable) return
    // The committed version disables the controls mid-flight; hand focus back
    // to the caret first so it cannot drop to document.body.
    refocusCaretBeforeFlight()
    update.mutate(
      { baseVersionId, markings },
      {
        onSuccess: (data) => onSaved(data.versionId),
        onError: (error) => {
          // A stale base is the same conflict a save reports; share its
          // banner so the reload affordance appears in one place.
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
  return {
    markings,
    pending: update.isPending,
    unavailable: unavailable ?? undefined,
    onDocumentKind: (documentKind) => commit({ ...markings, documentKind }),
    onToggleDraft: () => commit({ ...markings, draft: !markings.draft }),
    onTogglePrivileged: () =>
      commit({ ...markings, privileged: !markings.privileged }),
    onToggleWithoutPrejudice: () =>
      commit({ ...markings, withoutPrejudice: !markings.withoutPrejudice }),
  }
}
