import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'

import { documentBreakToolbar } from '../../document-break-toolbar'
import type { BreakDraft } from '../../document-edits'
import type { FormatTarget } from '../../document-format-edits'
import { documentStory } from '../../document-model-text'
import {
  documentStructureToolbar,
  storyTableCellIds,
} from '../../document-structure-toolbar'
import {
  readImageInsert,
  type StructuralDraft,
} from '../../document-structural-drafts'
import type { DocumentStructureToolbar } from './ribbon-types'

export type InsertRibbonProps = {
  onPageBreak: () => void
  onSectionBreak: () => void
  breakUnavailable?: string
  structure: DocumentStructureToolbar & { picturePicker: ReactNode }
}

/**
 * The Insert ribbon's controls, spread over `DocumentWorkspaceToolbar`: the
 * break pair, the table and picture insertions, and the hidden file input
 * whose change event reads the picked image into an `insert_image` draft.
 * The input mounts inside the ribbon's Tables group — `display: none` — so
 * it exists whenever the Picture button can forward a click to it.
 *
 * Structural anchors are validated against the stored model — a pending
 * paragraph or a folded cell wire has no server-side anchor yet — while the
 * break caret reads the painted model, matching the ribbon's previous
 * behaviour. The cell set is memoised on the stored model so the block
 * partition is not re-parsed per render.
 */
export function useInsertRibbon(
  model: DocumentModelWire | undefined,
  painted: DocumentModelWire | undefined,
  caret: FormatTarget,
  offset: number | null,
  trackChanges: boolean,
  drafts: {
    deletedParagraphIds: string[]
    setBreaks: (update: (current: BreakDraft[]) => BreakDraft[]) => void
    setStructures: (
      update: (current: StructuralDraft[]) => StructuralDraft[],
    ) => void
  },
  onImageError: (message: string) => void,
): InsertRibbonProps {
  const pictureInput = useRef<HTMLInputElement>(null)
  const cellParagraphIds = useMemo(
    () => storyTableCellIds(model ? documentStory(model) : undefined),
    [model],
  )
  const paragraphId = (caret.kind === 'caret' && caret.paragraphId) || null
  const selectionActive = caret.kind === 'selection'
  // A hyperlink marks a single-paragraph selection; a selection covering
  // several paragraphs carries one range per paragraph and is refused.
  const selectionRange =
    caret.kind === 'selection' && caret.ranges.length === 1
      ? (caret.ranges[0] ?? null)
      : null
  const structure = documentStructureToolbar({
    paragraphId,
    model,
    cellParagraphIds,
    offset,
    selectionActive,
    selectionRange,
    deletedParagraphIds: new Set(drafts.deletedParagraphIds),
    trackChanges,
    setStructures: drafts.setStructures,
  })
  return {
    ...documentBreakToolbar({
      paragraphId,
      model: painted ?? model,
      offset,
      selectionActive,
      trackChanges,
      setBreaks: drafts.setBreaks,
    }),
    structure: {
      tableUnavailable: structure.tableUnavailable,
      pictureUnavailable: structure.pictureUnavailable,
      linkUnavailable: structure.linkUnavailable,
      crossReferenceUnavailable: structure.crossReferenceUnavailable,
      crossReferenceTargets: structure.crossReferenceTargets,
      onInsertTable: (rows, columns) => structure.insertTable(rows, columns),
      onInsertLink: (target) => structure.insertLink(target),
      onInsertCrossReference: (targetParagraphId) =>
        structure.insertCrossReference(targetParagraphId),
      onInsertPicture: () => pictureInput.current?.click(),
      picturePicker: (
        <input
          ref={pictureInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp"
          className="hidden"
          aria-label="Insert picture"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void readImageInsert(file).then((result) => {
              if ('error' in result) {
                onImageError(result.error)
                return
              }
              const outcome = structure.insertImage(result)
              if (!outcome.inserted) onImageError(outcome.reason)
            })
          }}
        />
      ),
    },
  }
}
