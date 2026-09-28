import { useState } from 'react'
import type { DraftState } from './document-save-plan'

export type WorkspaceDraftSnapshot = DraftState

const HISTORY_LIMIT = 50

export function cloneWorkspaceDraft(
  snapshot: WorkspaceDraftSnapshot,
): WorkspaceDraftSnapshot {
  return structuredClone(snapshot)
}

export function pushWorkspaceDraft(
  history: readonly WorkspaceDraftSnapshot[],
  snapshot: WorkspaceDraftSnapshot,
): WorkspaceDraftSnapshot[] {
  return [...history.slice(1 - HISTORY_LIMIT), cloneWorkspaceDraft(snapshot)]
}

export function popWorkspaceDraft(history: readonly WorkspaceDraftSnapshot[]): {
  history: WorkspaceDraftSnapshot[]
  snapshot: WorkspaceDraftSnapshot
} | null {
  if (history.length === 0) return null
  const snapshot = history[history.length - 1]
  if (!snapshot) return null
  return { history: history.slice(0, -1), snapshot }
}

/**
 * The workspace's undo and redo stacks, and their only owner. An edit records
 * the state it is about to replace; undo moves the current state onto the redo
 * branch, and redo moves it back. Recording a new edit ends the redo branch,
 * because the document has moved past the state it held. Documents are kept
 * apart by the workspace remount key rather than a document id here.
 */
export function useWorkspaceDraftHistory() {
  const [past, setPast] = useState<WorkspaceDraftSnapshot[]>([])
  const [future, setFuture] = useState<WorkspaceDraftSnapshot[]>([])

  function record(snapshot: WorkspaceDraftSnapshot) {
    setPast((current) => pushWorkspaceDraft(current, snapshot))
    setFuture([])
  }

  function clear() {
    setPast([])
    setFuture([])
  }

  /**
   * Rewrites every snapshot with the save boundary's translation. A snapshot
   * the boundary cannot express is dropped rather than left replayable, and the
   * caller is told so it can surface the loss instead of silently continuing.
   * This is the history's only view of a baseline advance, so undo and redo
   * always restore a state the saved document can actually hold.
   */
  function translate(
    rewrite: (
      snapshot: WorkspaceDraftSnapshot,
    ) => WorkspaceDraftSnapshot | null,
  ) {
    let translated = true
    const map = (stack: WorkspaceDraftSnapshot[]) =>
      stack.flatMap((snapshot) => {
        const next = rewrite(snapshot)
        if (!next) {
          translated = false
          return []
        }
        return [next]
      })
    setPast(map)
    setFuture(map)
    return { translated }
  }

  /**
   * Ends the redo branch without touching undo history or the current state.
   * A successful save is a new baseline: every snapshot the branch holds was
   * taken while the saved slots were still pending, so replaying one would
   * reintroduce them as unsaved work and a later save would resend them. Undo
   * history and anything typed but not yet saved are deliberately left alone.
   */
  function discardRedo() {
    setFuture([])
  }

  function stepBack(current: WorkspaceDraftSnapshot) {
    const popped = popWorkspaceDraft(past)
    if (!popped) return null
    setPast(popped.history)
    setFuture((branch) => pushWorkspaceDraft(branch, current))
    return popped.snapshot
  }

  function stepForward(current: WorkspaceDraftSnapshot) {
    const popped = popWorkspaceDraft(future)
    if (!popped) return null
    setFuture(popped.history)
    setPast((branch) => pushWorkspaceDraft(branch, current))
    return popped.snapshot
  }

  return {
    record,
    clear,
    translate,
    discardRedo,
    stepBack,
    stepForward,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
