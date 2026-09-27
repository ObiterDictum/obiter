import { useEffect, useRef } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  resolveBaselineIdentities,
  translateSnapshot,
  type SaveBaseline,
} from '../../document-history-baseline'
import type { DraftSlot, DraftState } from '../../document-save-plan'
import type { useWorkspaceDraftHistory } from '../../document-editor-history'

type DraftHistory = ReturnType<typeof useWorkspaceDraftHistory>

/**
 * Owns the one record of where the history baseline has advanced to. A
 * successful save translates the history through `commit`; the effect resolves
 * the structural reversals the reloaded model has just named. The draft hook
 * keeps the live state; this hook keeps only the boundary between it and the
 * saved document.
 */
export function useSaveBaseline({
  history,
  model,
  resolveState,
}: {
  history: DraftHistory
  model: DocumentModelWire | undefined
  resolveState: (resolve: (state: DraftState) => DraftState) => void
}) {
  const pending = useRef<SaveBaseline | null>(null)

  // The reloaded `/model` names the paragraphs a save created or removed. The
  // boundary resolves its placeholders to those identities once, then is spent.
  useEffect(() => {
    const boundary = pending.current
    if (!boundary || !model || model === boundary.fromModel) return
    const resolved: SaveBaseline = { ...boundary, toModel: model }
    history.translate((snapshot) =>
      resolveBaselineIdentities(snapshot, resolved),
    )
    resolveState((state) => resolveBaselineIdentities(state, resolved))
    pending.current = null
    // `history` and `resolveState` are recreated per render; depending on them
    // would run this on every render rather than on the baseline change it
    // exists for, so the model is the only dependency.
  }, [model])

  return {
    commit(
      covered: readonly DraftSlot[],
      sent: DraftState,
      fromModel: DocumentModelWire,
    ) {
      history.discardRedo()
      if (covered.length === 0) return
      const boundary: SaveBaseline = { covered, sent, fromModel }
      history.translate((snapshot) => translateSnapshot(snapshot, boundary))
      pending.current = boundary
    },
    clear() {
      pending.current = null
    },
  }
}
