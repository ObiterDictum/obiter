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

export type BaselineBlockReason = 'lineage' | 'newer-version' | 'reload-failed'

export type BaselineCommitResult = {
  resolved: boolean
  reason?: BaselineBlockReason
}

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
  const decisionPending = useRef<{
    versionId: string
    versionNumber: number | undefined
    fromVersionId: string | undefined
  } | null>(null)
  const [pendingVersion, setPendingVersion] = useState<string | null>(null)
  const [paragraphRemap, setParagraphRemap] = useState<
    ReadonlyMap<string, string>
  >(new Map())
  const stateRef = useRef(state)
  stateRef.current = state
  const resolveStateRef = useRef(resolveState)
  resolveStateRef.current = resolveState
  const onBlockedRef = useRef(onBlocked)
  onBlockedRef.current = onBlocked

  useBrowserLayoutEffect(() => {
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
      if (modelVersionId === decision.fromVersionId) return
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
      onBlockedRef.current('reload-failed')
      return
    }
    if (!model) return
    if (modelVersionId === boundary.versionId) {
      const resolved: SaveBaseline = { ...boundary, toModel: model }
      history.translate(
        (snapshot) => remapLiveDraftState(snapshot, resolved).state,
      )
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
    if (modelVersionId === boundary.fromVersionId) return
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
  }, [model, modelVersionId, modelVersionNumber, modelError, pendingVersion])

  return {
    commit(
      covered: readonly DraftSlot[],
      sent: DraftState,
      fromModel: DocumentModelWire,
      fromVersionId: string | undefined,
      lineage?: SaveBaseline['lineage'],
      versionId?: string,
      versionNumber?: number,
    ): BaselineCommitResult {
      history.discardRedo()
      if (covered.length === 0) return { resolved: true }
      const boundary: SaveBaseline = {
        covered,
        sent,
        fromModel,
        fromVersionId,
        lineage,
        versionId,
        versionNumber,
      }
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
      decisionPending.current = {
        versionId,
        versionNumber,
        fromVersionId: modelVersionId,
      }
      setPendingVersion(versionId)
    },
    pendingVersion,
    paragraphRemap,
  }
}
