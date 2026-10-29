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

type DecisionMutation = Pick<
  ReturnType<typeof useTrackedChangeDecision>,
  'isPending' | 'error' | 'mutate'
>

export type ChangeReview = ReturnType<typeof useChangeReview>

function undecidableReason(change: DocumentChangeWire) {
  if (change.undecidable === 'unsupported-move') {
    return 'This move cannot be decided here; it stays listed and unchanged in the document.'
  }
  if (change.undecidable === 'missing-property-snapshot') {
    return 'This formatting change does not record the properties it replaced, so it cannot be decided.'
  }
  return undefined
}

export function useChangeReview({
  documentId,
  model,
  changes,
  baseVersionId,
  trackChanges,
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
  trackChanges: boolean
  decision: DecisionMutation
  drafts: WorkspaceDrafts
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
  const current =
    activeChange ??
    changes.find(
      (change) =>
        change.paragraphId !== undefined &&
        change.paragraphId === caret.selectedParagraphId,
    )

  const status = save.saveState.status
  const unavailable =
    decision.isPending || status === 'saving'
      ? 'A save or decision is still being committed.'
      : status === 'blocked'
        ? 'The edit history is blocked; resolve it before deciding changes.'
        : status === 'stale'
          ? 'Reload before deciding changes.'
          : status === 'failed'
            ? 'The last save failed; resolve it before deciding changes.'
            : save.editsPending
              ? 'Save or discard unsaved edits before deciding changes.'
              : null
  const supported = changes.filter((change) => change.undecidable === undefined)
  const undecidableCount = changes.length - supported.length
  const bulkUnavailable =
    changes.length === 0
      ? 'There are no tracked changes.'
      : (unavailable ??
        (supported.length > TRACKED_DECISION_MAX_IDS
          ? `More than ${TRACKED_DECISION_MAX_IDS} supported changes must be decided in smaller groups.`
          : supported.length === 0
            ? 'None of the listed changes can be decided here; they stay listed and unchanged in the document.'
            : undefined))
  const targetUnavailable =
    unavailable ??
    (changes.length === 0
      ? 'There are no tracked changes.'
      : current
        ? undecidableReason(current)
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
    const before = change.inlinePosition?.beforeRunId
    const offset =
      change.inlinePosition && paragraph
        ? before && paragraph.runs.some((run) => run.id === before)
          ? paragraphRunStart(paragraph, before, drafts.drafts)
          : paragraph.runs.reduce(
              (n, run) => n + (drafts.drafts[run.id] ?? run.text).length,
              0,
            )
        : change.runId && paragraph
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
    const undecidableIds = new Set(
      changes
        .filter((change) => change.undecidable !== undefined)
        .map((change) => change.id),
    )
    if (
      unavailable ||
      !model ||
      changeIds.length === 0 ||
      changeIds.length > TRACKED_DECISION_MAX_IDS ||
      changeIds.some((id) => undecidableIds.has(id))
    ) {
      return
    }
    const removeParagraphIds =
      action === 'reject'
        ? rejectedShellParagraphIds(model, changes, new Set(changeIds))
        : []
    refocusCaretBeforeFlight()
    decision.mutate(
      {
        baseVersionId,
        action,
        changeIds,
        ...(removeParagraphIds.length > 0 ? { removeParagraphIds } : {}),
        ...(trackChanges !== model.trackRevisions
          ? { trackRevisions: trackChanges }
          : {}),
      },
      {
        onSuccess: (data) => {
          drafts.resetHistoryAfterDecision(data.versionId, data.versionNumber)
          onSaved(data.versionId)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'conflict_detected')
            save.markStale()
        },
      },
    )
  }

  return {
    changes,
    activeChangeId: activeChange?.id,
    inlineTabChangeId: (activeChange && paintedInline(activeChange, model)
      ? activeChange
      : changes.find((change) => paintedInline(change, model))
    )?.id,
    activeIndex,
    pending: decision.isPending,
    error: decision.error ? "Your decision wasn't saved. Try again." : null,
    unavailable,
    bulkUnavailable,
    targetUnavailable,
    undecidableCount,
    undecidableReason,
    canPrevious: activeIndex > 0,
    canNext: changes.length > 0 && activeIndex < changes.length - 1,
    goTo,
    goToAdjacentInline: (fromId: string, direction: -1 | 1) => {
      for (
        let index =
          changes.findIndex((change) => change.id === fromId) + direction;
        index >= 0 && index < changes.length;
        index += direction
      ) {
        const change = changes[index]
        if (change && paintedInline(change, model)) {
          setActive({ id: change.id, index })
          caret.closeEditingStory()
          return
        }
      }
    },
    goToPrevious: () => goTo(activeIndex - 1),
    goToNext: () => goTo(activeIndex + 1),
    decideChange: (action: 'accept' | 'reject', change: DocumentChangeWire) => {
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
        supported.map((change) => change.id),
      ),
    decideSelected: (action: 'accept' | 'reject', changeIds: string[]) => {
      const chosen = new Set(changeIds)
      decide(
        action,
        supported
          .filter((change) => chosen.has(change.id))
          .map((change) => change.id),
      )
    },
  }
}

function paintedInline(change: DocumentChangeWire, model?: DocumentModelWire) {
  return Boolean(
    change.kind !== 'property' &&
    model?.stories.some(
      (story) =>
        story.partName === change.storyPartName && story.kind !== 'comments',
    ) &&
    change.inlinePosition &&
    (change.inlinePosition.segments ?? [change]).some(
      (segment) => segment.text.length > 0,
    ),
  )
}
