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
    stepBack,
    stepForward,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
