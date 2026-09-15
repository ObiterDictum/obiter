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
