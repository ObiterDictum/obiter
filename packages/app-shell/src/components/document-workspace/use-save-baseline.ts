import { useRef, useState } from 'react'
import { useBrowserLayoutEffect } from './use-browser-layout-effect'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  lineageCoversCoveredSlots,
  paragraphMapFromLineage,
  remapLiveDraftState,
  translateSnapshot,
  type SaveBaseline,
} from '../../document-history-baseline'
import type { DraftSlot, DraftState } from '../../document-save-plan'
import type { useWorkspaceDraftHistory } from '../../document-editor-history'

type DraftHistory = ReturnType<typeof useWorkspaceDraftHistory>

/**
 * Why the save boundary cannot be reconciled, when it cannot. Each carries its
 * own recovery: a missing or incomplete lineage, a document that moved past the
 * committed version, or a reload that failed before the result model arrived.
 */
export type BaselineBlockReason = 'lineage' | 'newer-version' | 'reload-failed'

/** The outcome of advancing the history baseline after a committed save. */
export type BaselineCommitResult = {
  resolved: boolean
  reason?: BaselineBlockReason
}

/**
 * Owns the one record of where the history baseline has advanced to. A
 * successful save translates the history through `commit`; the effect resolves
 * the run and paragraph addresses the reloaded model has just named. The draft
 * hook keeps the live state; this hook keeps only the boundary between it and
 * the saved document.
 */
export function useSaveBaseline({
  history,
  model,
  modelVersionId,
  modelVersionNumber,
  modelError,
  state,
  resolveState,
  onBlocked,
}: {
  history: DraftHistory
  model: DocumentModelWire | undefined
  modelVersionId: string | undefined
  modelVersionNumber: number | undefined
  modelError: boolean
  state: DraftState
  resolveState: (update: (current: DraftState) => DraftState) => void
  onBlocked: (reason: BaselineBlockReason | null) => void
}) {
  const pending = useRef<SaveBaseline | null>(null)
  // A tracked decision commits a version with no lineage. There is nothing to
  // translate, but saves must still wait for the exact version's model so the
  // next edit is not planned against the pre-decision run ids.
  const decisionPending = useRef<{
    versionId: string
    versionNumber: number | undefined
  } | null>(null)
  // Exposed so the workspace can refuse a second save until the model for the
  // committed version has actually reloaded.
  const [pendingVersion, setPendingVersion] = useState<string | null>(null)
  // The base-to-result paragraph map of the last resolved boundary, so the
  // workspace can retarget live caret and draft paragraph ids.
  const [paragraphRemap, setParagraphRemap] = useState<
    ReadonlyMap<string, string>
  >(new Map())
  // The live draft state and the callbacks are read through refs: they are
  // recreated per render, and depending on them would run this effect on every
  // render rather than on the model change it exists for.
  const stateRef = useRef(state)
  stateRef.current = state
  const resolveStateRef = useRef(resolveState)
  resolveStateRef.current = resolveState
  const onBlockedRef = useRef(onBlocked)
  onBlockedRef.current = onBlocked

  // The reloaded `/model` names the content a save created or moved. The
  // boundary resolves only against the exact result version the lineage
  // describes; a response that fails to load, or that carries a version this
  // save did not produce, is surfaced rather than leaving a permanent
  // "Saving…" with an enabled-but-inert Save button.
  // This is a layout effect: resolving publishes the paragraph remap the
  // caret lineage retargets, and both have to land inside the swap's commit
  // cascade — a passive-effect hop leaves a window where the focused editor
  // is already gone and the next keystroke falls through to document.body.
  useBrowserLayoutEffect(() => {
    // A tracked decision carries no lineage to translate; the gate exists only
    // so the next save plans against the reloaded model for that exact version.
    const decision = decisionPending.current
    if (decision) {
      if (modelError) {
        onBlockedRef.current('reload-failed')
        return
      }
      if (!model) return
      if (modelVersionId === decision.versionId) {
        decisionPending.current = null
        setPendingVersion(null)
        onBlockedRef.current(null)
        return
      }
      if (
        modelVersionNumber !== undefined &&
        decision.versionNumber !== undefined &&
        modelVersionNumber < decision.versionNumber
      ) {
        return
      }
      decisionPending.current = null
      setPendingVersion(null)
      onBlockedRef.current('newer-version')
      return
    }
    const boundary = pending.current
    if (!boundary || !boundary.versionId) return
    if (modelError) {
      // Keep the boundary so a successful retry can still resolve it, but say
      // plainly that the reload failed instead of waiting forever.
      onBlockedRef.current('reload-failed')
      return
    }
    if (!model) return
    if (modelVersionId === boundary.versionId) {
      const resolved: SaveBaseline = { ...boundary, toModel: model }
      history.translate(
        (snapshot) => remapLiveDraftState(snapshot, resolved).state,
      )
      // The live-state rewrite goes through the updater form: `stateRef` is
      // the last rendered state, but an edit can be queued and still
      // unrendered when this effect runs — it only ever runs after the commit
      // — so replacing state wholesale would discard that edit. Remapping
      // `current` at application time keeps it. `unresolved` stays a read of
      // the rendered state: a queued edit that added an unresolvable key
      // would still be held back as a blocked draft at the next save, which
      // is a banner rather than silent loss.
      const { unresolved } = remapLiveDraftState(stateRef.current, resolved)
      resolveStateRef.current(
        (current) => remapLiveDraftState(current, resolved).state,
      )
      if (resolved.lineage) {
        setParagraphRemap(paragraphMapFromLineage(resolved.lineage))
      }
      pending.current = null
      setPendingVersion(null)
      onBlockedRef.current(unresolved ? 'lineage' : null)
      return
    }
    // A version this save did not produce. An older one is a stale response
    // from a query that raced the commit; ignore it and keep waiting. A newer
    // one means another operation or collaborator committed, so the exact
    // saved model is no longer served: block honestly rather than wedge.
    if (
      modelVersionNumber !== undefined &&
      boundary.versionNumber !== undefined &&
      modelVersionNumber < boundary.versionNumber
    ) {
      return
    }
    pending.current = null
    setPendingVersion(null)
    onBlockedRef.current('newer-version')
  }, [model, modelVersionId, modelVersionNumber, modelError])

  return {
    commit(
      covered: readonly DraftSlot[],
      sent: DraftState,
      fromModel: DocumentModelWire,
      lineage?: SaveBaseline['lineage'],
      versionId?: string,
      versionNumber?: number,
    ): BaselineCommitResult {
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
        versionNumber,
      }
      // An unsupported or incomplete response is never guessed around: the
      // caller surfaces a recoverable blocked state instead of risking another
      // write or silently discarding the reversal.
      if (!lineage || !versionId) {
        pending.current = null
        setPendingVersion(null)
        return { resolved: false, reason: 'lineage' }
      }
      if (!lineageCoversCoveredSlots(lineage, boundary)) {
        pending.current = null
        setPendingVersion(null)
        return { resolved: false, reason: 'lineage' }
      }
      const { translated } = history.translate((snapshot) =>
        translateSnapshot(snapshot, boundary),
      )
      if (!translated) {
        // A snapshot could not be expressed against the saved document. Its
        // reversal is unrepresentable, so the history is not silently dropped:
        // the workspace enters the recoverable blocked state.
        pending.current = null
        setPendingVersion(null)
        return { resolved: false, reason: 'lineage' }
      }
      pending.current = boundary
      setPendingVersion(versionId)
      return { resolved: true }
    },
    clear() {
      pending.current = null
      decisionPending.current = null
      setPendingVersion(null)
      setParagraphRemap(new Map())
    },
    markDecisionCommitted(versionId: string, versionNumber?: number) {
      decisionPending.current = { versionId, versionNumber }
      setPendingVersion(versionId)
    },
    pendingVersion,
    paragraphRemap,
  }
}
