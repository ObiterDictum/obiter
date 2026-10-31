import type { PendingRedlines } from '../../document-pending-redlines'
import { useMemo } from 'react'
import {
  normaliseEditText,
  type DocumentModelWire,
  type DocumentPresence,
} from '@obiter/contracts'
import { batchParagraphDeletions } from '../../document-edits'
import { editingStoryFor } from '../../document-page-layout'
import { pageReferenceMap } from '../../document-page-references'
import type { LaidOutPage } from '../../document-page-engine'
import { documentDefaultFace } from '../../document-page-style'
import type { ParagraphLinkOverlay } from '../../document-structure-overlays'
import type { DocumentRangeRefusal } from '../../document-range-edits'
import { DocumentPage } from './document-page'
import { DocumentModelPage } from './model-view'
import type { ParagraphSelectionRange } from './model-run'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import type { VerticalCaretColumn } from './paragraph-arrow'
import type { ParagraphWordEdit } from './model-paragraph'
import { useLatestCallback } from './use-latest-callback'
import type { useWorkspaceDrafts } from './use-workspace-drafts'
import type { EditingKind } from './use-editing-story'

export function DocxModelPages({
  model,
  painted,
  pendingRedlines,
  pages,
  zoom,
  view = 'print',
  editingKind,
  selectedParagraphId,
  restoreCaret,
  verticalCaret,
  drafts,
  presence,
  currentUserId,
  imageUrls,
  selectionSegments,
  linkOverlays,
  selectionHandlers,
  selectParagraph,
  setFormatRange,
  mirrorSelection,
  focusParagraph,
  moveCaret,
  reportJoinRefusal,
  onExitMarginEditing,
  onOpenNoteEditing,
}: {
  model: DocumentModelWire
  painted: DocumentModelWire | undefined
  pendingRedlines?: PendingRedlines
  pages: LaidOutPage[]
  zoom: number
  view?: 'print' | 'web'
  editingKind: EditingKind
  selectedParagraphId: string | null
  restoreCaret: { paragraphId: string; offset: number } | null
  verticalCaret: VerticalCaretColumn
  drafts: ReturnType<typeof useWorkspaceDrafts>
  presence: DocumentPresence[]
  currentUserId?: string
  imageUrls: Record<string, string>
  selectionSegments: ReadonlyMap<string, ParagraphSelectionRange>
  linkOverlays?: ReadonlyMap<string, ParagraphLinkOverlay>
  selectionHandlers: ParagraphSelectionHandlers
  selectParagraph: (paragraphId: string, offset?: number) => void
  setFormatRange: (range: { from: number; to: number }) => void
  mirrorSelection: (
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) => void
  focusParagraph: (paragraphId: string) => void
  moveCaret: (paragraphId: string, offset: number) => void
  reportJoinRefusal: (refusal: DocumentRangeRefusal) => void
  onExitMarginEditing: () => void
  onOpenNoteEditing: (paragraphId: string) => void
}) {
  const rendered = painted ?? model
  const marginEditing =
    editingKind === 'document'
      ? undefined
      : editingStoryFor(rendered, editingKind)
  const pageReferences = useMemo(
    () => pageReferenceMap(rendered, pages),
    [rendered, pages],
  )
  const paintedDeletes = useMemo(
    () => [
      ...batchParagraphDeletions(
        model,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
        drafts.drafts,
      ).applied,
    ],
    [
      model,
      drafts.inserts,
      drafts.deletedParagraphIds,
      drafts.extraRuns,
      drafts.drafts,
    ],
  )
  const select = useLatestCallback(selectParagraph)
  const focus = useLatestCallback(focusParagraph)
  const move = useLatestCallback(moveCaret)
  const selectText = useLatestCallback(
    (
      paragraphId: string,
      from: number,
      to: number,
      direction: 'forward' | 'backward',
    ) => {
      setFormatRange({ from, to })
      mirrorSelection(paragraphId, from, to, direction)
    },
  )
  const changeRunText = useLatestCallback((runId: string, text: string) => {
    drafts.setDrafts((current) => ({
      ...current,
      [runId]: normaliseEditText(text),
    }))
  })
  const changeInsertText = useLatestCallback(
    (clientId: string, text: string) => {
      drafts.setInserts((current) =>
        current.map((item) =>
          item.clientId === clientId
            ? { ...item, text: normaliseEditText(text) }
            : item,
        ),
      )
    },
  )
  const insertParagraph = useLatestCallback((afterParagraphId: string) => {
    selectParagraph(drafts.insertAfter(afterParagraphId), 0)
  })
  const deleteParagraph = useLatestCallback((paragraphId: string) => {
    const { selectId } = drafts.deleteParagraph(paragraphId)
    if (selectId) selectParagraph(selectId)
  })
  const wordEdit = useLatestCallback((edit: ParagraphWordEdit) => {
    const outcome = drafts.handleWordEdit(model, edit)
    if (outcome?.status === 'applied') {
      selectParagraph(outcome.caret.paragraphId, outcome.caret.offset)
    } else if (outcome?.status === 'refused') {
      reportJoinRefusal(outcome.refusal)
    }
  })
  return (
    <>
      {pages.map((laid, index) => (
        <DocumentPage
          key={`page-${index + 1}`}
          zoom={zoom}
          width={laid.box.widthPx}
          height={
            view === 'web'
              ? Math.max(laid.contentPx ?? 0, 240)
              : laid.box.heightPx
          }
          fontFamily={documentDefaultFace(model.styles).fontFamily}
          chromeless={view === 'web'}
        >
          <DocumentModelPage
            pendingRedlines={pendingRedlines}
            model={rendered}
            marginEditing={marginEditing}
            chromeless={view === 'web'}
            onExitMarginEditing={onExitMarginEditing}
            onOpenNoteEditing={onOpenNoteEditing}
            pageNumber={index + 1}
            pageReferences={pageReferences}
            pageBlocks={laid.blocks}
            pageFloats={laid.floats}
            pageTextBoxes={laid.textBoxes}
            pageLayout={laid}
            selectedParagraphId={selectedParagraphId}
            onSelectParagraph={select}
            onTextSelection={selectText}
            selectionSegments={selectionSegments}
            linkOverlays={linkOverlays}
            selectionHandlers={selectionHandlers}
            onFocusParagraph={focus}
            onMoveCaret={move}
            drafts={drafts.drafts}
            emphasis={drafts.format.emphasis}
            onRunTextChange={changeRunText}
            editing
            presence={presence}
            currentUserId={currentUserId}
            inserts={drafts.inserts}
            deletedParagraphIds={paintedDeletes}
            extraRuns={drafts.extraRuns}
            imageUrls={imageUrls}
            onInsertTextChange={changeInsertText}
            onInsertParagraph={insertParagraph}
            onDeleteParagraph={deleteParagraph}
            onWordEdit={wordEdit}
            restoreCaret={restoreCaret}
            verticalCaret={verticalCaret}
          />
        </DocumentPage>
      ))}
    </>
  )
}
