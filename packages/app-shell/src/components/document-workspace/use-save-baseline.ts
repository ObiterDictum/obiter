import { useEffect, useRef, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  lineageCoversCoveredSlots,
  paragraphMapFromLineage,
  remapDraftStateParagraphs,
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
  modelVersionId,
  resolveState,
}: {
  history: DraftHistory
  model: DocumentModelWire | undefined
  modelVersionId: string | undefined
  resolveState: (resolve: (state: DraftState) => DraftState) => void
}) {
  const pending = useRef<SaveBaseline | null>(null)
  // Exposed so the workspace can refuse a second save until the model for the
  // committed version has actually reloaded.
  const [pendingVersion, setPendingVersion] = useState<string | null>(null)
  // The base-to-result paragraph map of the last resolved boundary, so the
  // workspace can retarget live caret and draft paragraph ids.
  const [paragraphRemap, setParagraphRemap] = useState<
    ReadonlyMap<string, string>
  >(new Map())

  // The reloaded `/model` names the paragraphs a save created or removed. The
  // boundary resolves against the exact result version the lineage describes;
  // a stale or out-of-order model never resolves an unrelated boundary.
  useEffect(() => {
    const boundary = pending.current
    if (!boundary || !model || !boundary.versionId) return
    if (modelVersionId !== boundary.versionId) return
    const resolved: SaveBaseline = { ...boundary, toModel: model }
    history.translate((snapshot) =>
      resolveBaselineIdentities(snapshot, resolved),
    )
    if (resolved.lineage) {
      const lineage = resolved.lineage
      resolveState((state) =>
        remapDraftStateParagraphs(
          resolveBaselineIdentities(state, resolved),
          lineage,
        ),
      )
      setParagraphRemap(paragraphMapFromLineage(lineage))
    } else {
      resolveState((state) => resolveBaselineIdentities(state, resolved))
    }
    pending.current = null
    setPendingVersion(null)
    // `history` and `resolveState` are recreated per render; depending on them
    // would run this on every render rather than on the baseline change it
    // exists for, so the model is the only dependency.
  }, [model, modelVersionId])

  return {
    commit(
      covered: readonly DraftSlot[],
      sent: DraftState,
      fromModel: DocumentModelWire,
      lineage?: SaveBaseline['lineage'],
      versionId?: string,
      tracked = false,
    ): { resolved: boolean } {
      // A successful save ends the redo branch whether or not its identity can
      // be reconciled.
      history.discardRedo()
      if (covered.length === 0) return { resolved: true }
      const boundary: SaveBaseline = {
        covered,
        sent,
        fromModel,
        lineage,
        versionId,
      }
      // An unsupported or incomplete response is never guessed around: the
      // caller surfaces a recoverable blocked state instead of risking another
      // write or silently discarding the reversal.
      if (
        !lineage ||
        !versionId ||
        !lineageCoversCoveredSlots(lineage, boundary, tracked)
      ) {
        pending.current = null
        setPendingVersion(null)
        return { resolved: false }
      }
      history.translate((snapshot) => translateSnapshot(snapshot, boundary))
      pending.current = boundary
      setPendingVersion(versionId)
      return { resolved: true }
    },
    clear() {
      pending.current = null
      setPendingVersion(null)
      setParagraphRemap(new Map())
    },
    pendingVersion,
    paragraphRemap,
  }
}
