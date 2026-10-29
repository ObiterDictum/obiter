import type { DocumentModelWire } from '@obiter/contracts'
import { historyCaretPlacement } from '../../document-history-caret'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

export function useHistoryCaret({
  model,
  drafts,
  restoreCaret,
  selectedParagraphId,
  onPlaceCaret,
  onClearSelection,
}: {
  model: DocumentModelWire | undefined
  drafts: Pick<
    ReturnType<typeof useWorkspaceDrafts>,
    'inserts' | 'deletedParagraphIds' | 'undoDraft' | 'redoDraft'
  >
  restoreCaret: { paragraphId: string; offset: number } | null
  selectedParagraphId: string | null
  onPlaceCaret: (paragraphId: string, offset: number) => void
  onClearSelection: () => void
}) {
  function runHistoryStep(step: () => ReturnType<typeof drafts.undoDraft>) {
    const before = {
      inserts: drafts.inserts,
      deletedParagraphIds: drafts.deletedParagraphIds,
    }
    const restored = step()
    if (!restored || !model) return
    onClearSelection()
    const anchor = restoreCaret?.paragraphId ?? selectedParagraphId
    if (!anchor) return
    const placement = historyCaretPlacement({ model, before, restored, anchor })
    if (placement) onPlaceCaret(placement.paragraphId, placement.offset)
  }

  return {
    undoDocument: () => runHistoryStep(drafts.undoDraft),
    redoDocument: () => runHistoryStep(drafts.redoDraft),
  }
}
