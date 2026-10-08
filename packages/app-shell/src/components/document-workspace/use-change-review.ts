import { useRef, useState } from 'react'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentChangeWire,
  type DocumentModelWire,
} from '@obiter/contracts'
import { ApiError } from '../../api'
import { rejectedShellParagraphIds } from '../../document-review'
import {
  editableParagraph,
  editableStoryOf,
  paragraphRunStart,
} from '../../document-model-text'
import type { useTrackedChangeDecision } from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import type { useDocumentSave } from './use-document-save'
import type { useEditingStory } from './use-editing-story'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import { mutationError } from './workspace-chrome'

type DecisionMutation = Pick<
  ReturnType<typeof useTrackedChangeDecision>,
  'isPending' | 'error' | 'mutate'
>

export type ChangeReview = ReturnType<typeof useChangeReview>

/**
 * The tracked-change review state the ribbon and the Changes panel share.
 * One active target, one availability answer and one dispatch live here, so
 * the ribbon's single/bulk actions and the panel's per-change buttons can
 * never disagree about what deciding means right now.
 *
 * A decision is an immutable version, so it is refused while unsaved work or
 * an unresolved boundary could make it write against the wrong base — the
 * controls stay disabled with the reason on their accessible name rather
 * than discarding a draft or landing a stale write.
 */
export function useChangeReview({
  documentId,
  model,
  changes,
  baseVersionId,
  decision,
  drafts,
  save,
  caret,
  onSaved,
  onNotice,
}: {
  documentId: string
  model: DocumentModelWire | undefined
  changes: readonly DocumentChangeWire[]
  baseVersionId: string
  decision: DecisionMutation
  drafts: WorkspaceDrafts
  /** The save state machine; a decision shares its unsaved-work barriers. */
  save: ReturnType<typeof useDocumentSave>
  caret: {
    editingKind: ReturnType<typeof useEditingStory>['editingKind']
    selectParagraph: (paragraphId: string, offset?: number) => void
    openEditingStory: (
      kind: 'header' | 'footer' | 'footnotes',
      selectId?: string,
      offset?: number,
    ) => void
    closeEditingStory: () => void
    selectedParagraphId: string | null
  }
  onSaved: (versionId: string) => void
  onNotice: (message: string) => void
}) {
  // The active target keeps its list position across a decision: the decided
  // change leaves the list, so the slot it held names the next change to
  // review without a second navigation step.
  const [active, setActive] = useState<{ id: string; index: number } | null>(
    null,
  )
  const documentRef = useRef(documentId)
  if (documentRef.current !== documentId) {
    documentRef.current = documentId
    setActive(null)
  }

  const listed = changes.findIndex((change) => change.id === active?.id)
  const activeIndex =
    listed >= 0
      ? listed
      : active
        ? Math.min(active.index, changes.length - 1)
        : -1
  const activeChange = activeIndex >= 0 ? changes[activeIndex] : undefined
  // The ribbon's single Accept/Reject target: the active change, else the
  // first change anchored at the caret's paragraph — the same deterministic
  // "current" a word processor's review commands use.
  const current =
    activeChange ??
    changes.find(
      (change) =>
        change.paragraphId !== undefined &&
        change.paragraphId === caret.selectedParagraphId,
    )

  // A decision is an immutable version, so it may run only when nothing
  // unsaved or unresolved could silently retarget against the new base. The
  // save state machine is the single truth for that: anything but 'saved'
  // names its own reason on the disabled controls rather than losing work.
  const status = save.saveState.status
  const unavailable =
    decision.isPending || status === 'saving'
      ? 'A save or decision is still being committed.'
      : status === 'blocked'
        ? 'The edit history is blocked; resolve it before deciding changes.'
        : status === 'stale'
          ? 'The document changed on the server; reload before deciding changes.'
          : status === 'failed'
            ? 'The last save failed; resolve it before deciding changes.'
            : status === 'unsaved'
              ? 'Save or discard unsaved edits before deciding changes.'
              : null
  const bulkUnavailable =
    changes.length === 0
      ? 'There are no tracked changes.'
      : changes.length > TRACKED_DECISION_MAX_IDS
        ? `More than ${TRACKED_DECISION_MAX_IDS} changes must be decided in smaller groups.`
        : (unavailable ?? undefined)
  const targetUnavailable =
    unavailable ??
    (changes.length === 0
      ? 'There are no tracked changes.'
      : current
        ? undefined
        : 'Go to a change first — use Previous, Next or the Changes list.')

  function reveal(change: DocumentChangeWire) {
    const story =
      model && change.paragraphId
        ? editableStoryOf(model, change.paragraphId)
        : undefined
    if (!story || !change.paragraphId) {
      onNotice('This change has no editable text location to show.')
      return
    }
    const paragraph = editableParagraph(model!, change.paragraphId)
    const offset =
      change.runId && paragraph
        ? paragraphRunStart(paragraph, change.runId, drafts.drafts)
        : 0
    if (story.kind === 'document') {
      if (caret.editingKind !== 'document') caret.closeEditingStory()
      caret.selectParagraph(change.paragraphId, offset)
    } else if (
      story.kind === 'header' ||
      story.kind === 'footer' ||
      story.kind === 'footnotes'
    ) {
      caret.openEditingStory(story.kind, change.paragraphId, offset)
    } else {
      onNotice('This change is not in an editable part of the document.')
    }
  }

  function goTo(index: number) {
    const change = changes[index]
    if (!change) return
    setActive({ id: change.id, index })
    reveal(change)
  }

  function decide(action: 'accept' | 'reject', changeIds: string[]) {
    if (
      unavailable ||
      !model ||
      changeIds.length === 0 ||
      changeIds.length > TRACKED_DECISION_MAX_IDS
    ) {
      return
    }
    // Rejection may remove a tracked-insert paragraph's empty shell in the
    // same decision; name only shells whose pending changes are all being
    // rejected, so nothing undecided can disappear inside one.
    const removeParagraphIds =
      action === 'reject'
        ? rejectedShellParagraphIds(model, changes, new Set(changeIds))
        : []
    // The decided change leaving the list disables the controls mid-flight;
    // hand focus back to the caret first so it cannot drop to document.body.
    refocusCaretBeforeFlight()
    decision.mutate(
      {
        baseVersionId,
        action,
        changeIds,
        ...(removeParagraphIds.length > 0 ? { removeParagraphIds } : {}),
      },
      {
        onSuccess: (data) => {
          // A decision version carries no lineage and re-allocates run ids,
          // so the pre-decision history cannot be replayed; the committed
          // version is held until its model reloads before anything edits.
          drafts.resetHistoryAfterDecision(data.versionId, data.versionNumber)
          onSaved(data.versionId)
        },
        onError: (error) => {
          // A stale base is the same conflict a save reports; share its
          // banner so the reload affordance appears in one place.
          if (error instanceof ApiError && error.code === 'conflict_detected')
            save.markStale()
        },
      },
    )
  }

  return {
    changes,
    /** The review target's own id, when one is marked active. */
    activeChangeId: activeChange?.id,
    activeIndex,
    pending: decision.isPending,
    error: mutationError(decision.error),
    /** Why no decision can run right now, or null when one can. */
    unavailable,
    /** Why a bulk decision is unavailable (barrier or the request cap). */
    bulkUnavailable,
    /** Why the single-change controls are unavailable, or undefined. */
    targetUnavailable,
    canPrevious: activeIndex > 0,
    canNext: changes.length > 0 && activeIndex < changes.length - 1,
    goTo,
    goToPrevious: () => goTo(activeIndex - 1),
    goToNext: () => goTo(activeIndex + 1),
    decideChange: (action: 'accept' | 'reject', change: DocumentChangeWire) => {
      // Marking the decided change active makes its slot name the next
      // change once this one leaves the list — review advances without a
      // second navigation step.
      const index = changes.findIndex((item) => item.id === change.id)
      if (index >= 0) setActive({ id: change.id, index })
      decide(action, [change.id])
    },
    decideCurrent: (action: 'accept' | 'reject') => {
      if (!current) return
      const index = changes.findIndex((item) => item.id === current.id)
      if (index >= 0) setActive({ id: current.id, index })
      decide(action, [current.id])
    },
    decideAll: (action: 'accept' | 'reject') =>
      decide(
        action,
        changes.map((change) => change.id),
      ),
  }
}
