import { useRef, useState } from 'react'
import {
  continuesTypingGroup,
  nextTypingGroup,
  type HistoryEdit,
  type TypingGroup,
} from './document-history-grouping'
import type { DraftState } from './document-save-plan'

export type WorkspaceDraftSnapshot = DraftState

const HISTORY_LIMIT = 50

function cloneWorkspaceDraft(
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

export function useWorkspaceDraftHistory() {
  const [stacks, setStacks] = useState<{
    past: WorkspaceDraftSnapshot[]
    future: WorkspaceDraftSnapshot[]
  }>({ past: [], future: [] })
  const latest = useRef(stacks)
  const group = useRef<TypingGroup | null>(null)

  function commitStacks(next: {
    past: WorkspaceDraftSnapshot[]
    future: WorkspaceDraftSnapshot[]
  }) {
    latest.current = next
    setStacks(next)
  }

  function record(snapshot: WorkspaceDraftSnapshot, edit?: HistoryEdit) {
    const now = Date.now()
    if (edit && continuesTypingGroup(group.current, edit, now)) {
      group.current = nextTypingGroup(edit, now)
      return
    }
    group.current = edit ? nextTypingGroup(edit, now) : null
    commitStacks({
      past: pushWorkspaceDraft(latest.current.past, snapshot),
      future: [],
    })
  }

  function clear() {
    group.current = null
    commitStacks({ past: [], future: [] })
  }

  function translate(
    rewrite: (
      snapshot: WorkspaceDraftSnapshot,
    ) => WorkspaceDraftSnapshot | null,
  ) {
    group.current = null
    const past = translateStack(latest.current.past, rewrite)
    const future = translateStack(latest.current.future, rewrite)
    if (!past || !future) return { translated: false }
    commitStacks({ past, future })
    return { translated: true }
  }

  function discardRedo() {
    commitStacks({ past: latest.current.past, future: [] })
  }

  function stepBack(current: WorkspaceDraftSnapshot) {
    const popped = popWorkspaceDraft(latest.current.past)
    if (!popped) return null
    group.current = null
    commitStacks({
      past: popped.history,
      future: pushWorkspaceDraft(latest.current.future, current),
    })
    return popped.snapshot
  }

  function stepForward(current: WorkspaceDraftSnapshot) {
    const popped = popWorkspaceDraft(latest.current.future)
    if (!popped) return null
    group.current = null
    commitStacks({
      past: pushWorkspaceDraft(latest.current.past, current),
      future: popped.history,
    })
    return popped.snapshot
  }

  return {
    record,
    clear,
    translate,
    discardRedo,
    stepBack,
    stepForward,
    canUndo: stacks.past.length > 0,
    canRedo: stacks.future.length > 0,
  }
}

function translateStack(
  stack: readonly WorkspaceDraftSnapshot[],
  rewrite: (snapshot: WorkspaceDraftSnapshot) => WorkspaceDraftSnapshot | null,
): WorkspaceDraftSnapshot[] | null {
  const mapped: WorkspaceDraftSnapshot[] = []
  for (const snapshot of stack) {
    const next = rewrite(snapshot)
    if (!next) return null
    mapped.push(next)
  }
  return mapped
}
