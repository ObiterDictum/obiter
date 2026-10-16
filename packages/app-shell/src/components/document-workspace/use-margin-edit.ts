import { useMemo } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { storyFlowParagraphIds, type LocalInsert } from '../../document-edits'
import { effectiveParagraph } from '../../document-model-text'
import type { ExtraRuns } from '../../document-word-edits'
import { storyBlocks } from '../../document-page-tables'
import {
  storyBlocksWithInserts,
  type LaidOutBlock,
} from '../../document-page-engine'
import { paragraphNeighborResolver } from './paragraph-arrow'

/**
 * The open margin story laid out like the body column: draft and extra-run
 * merges applied, pending inserts woven in, arrows and paragraph ops scoped
 * to its own flow order. Kept out of the page component so the body path
 * pays nothing when no margin story is open.
 */
export function useMarginEdit(
  marginEditing: DocumentStoryWire | undefined,
  model: DocumentModelWire,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
) {
  return useMemo(() => {
    if (!marginEditing) return undefined
    const marginOrder = storyFlowParagraphIds(
      marginEditing,
      inserts,
      deletedParagraphIds,
    )
    return {
      partName: marginEditing.partName,
      order: marginOrder,
      blocks: storyBlocksWithInserts(storyBlocks(marginEditing), inserts).map(
        (block): LaidOutBlock =>
          block.type === 'table'
            ? block
            : {
                ...block,
                paragraph: effectiveParagraph(
                  block.paragraph,
                  drafts,
                  extraRuns[block.paragraph.id] ?? [],
                ),
              },
      ),
      neighbors: paragraphNeighborResolver({
        model,
        extraRuns,
        inserts,
        deletedParagraphIds,
        paragraphs: marginEditing.paragraphs,
        order: marginOrder,
      }),
    }
  }, [marginEditing, model, inserts, deletedParagraphIds, drafts, extraRuns])
}
