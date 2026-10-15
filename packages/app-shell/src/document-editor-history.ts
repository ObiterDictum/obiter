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
 *
 * Consecutive typing in one paragraph coalesces into one entry: the first
 * keystroke records the pre-run state and the rest join it, so an undo reverses
 * the run rather than one character. Every structural edit, and every history
 * move, closes the run so the next keystroke starts a fresh step.
 */
export function useWorkspaceDraftHistory() {
  const [stacks, setStacks] = useState<{
    past: WorkspaceDraftSnapshot[]
    future: WorkspaceDraftSnapshot[]
  }>({ past: [], future: [] })
  // The synchronous truth `stacks` only catches up to at render: a save
  // queues `discardRedo` and `translate` in one tick, and the translation
  // must see the post-discard stacks to compute its honest answer. Every
  // mutation writes the ref and the state together.
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
      // The open run's snapshot already sits at the top of the stack: the undo
      // target is the state before the whole run, not before this keystroke.
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

  /**
   * Rewrites every snapshot with the save boundary's translation —
   * transactionally. Both stacks are computed before either is touched: a
   * snapshot the boundary cannot express reports unsupported and leaves both
   * stacks exactly as they were, so the caller holds the operation instead of
   * losing the unrelated history the snapshot also carries. This is the
   * history's only view of a baseline advance, so undo and redo always
   * restore a state the saved document can actually hold.
   */
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

  /**
   * Ends the redo branch without touching undo history or the current state.
   * A successful save is a new baseline: every snapshot the branch holds was
   * taken while the saved slots were still pending, so replaying one would
   * reintroduce them as unsaved work and a later save would resend them. Undo
   * history and anything typed but not yet saved are deliberately left alone.
   */
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

/**
 * Maps a stack through the boundary rewrite, or null when any snapshot
 * cannot be expressed — the all-or-nothing half of a `translate` call.
 */
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
