import { useMemo } from 'react'
import type { DocumentModelWire, DocumentPresence } from '@obiter/contracts'
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
import type { useWorkspaceDrafts } from './use-workspace-drafts'
import type { EditingKind } from './use-editing-story'

/**
 * The laid-out pages of the document. The margin story open for editing is
 * resolved against the painted model — the same wire the page renders — so
 * the band and the column never disagree about which part the caret sits in.
 */
export function DocxModelPages({
  model,
  painted,
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
  pages: LaidOutPage[]
  zoom: number
  /** 'web' is the continuous flow view: the sheets lose their paper chrome
   * and margin bands and the page measures its content. */
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
  /** A body click while a margin story is open closes the story. */
  onExitMarginEditing: () => void
  /** A footnote-body click opens the notes story at that paragraph. */
  onOpenNoteEditing: (paragraphId: string) => void
}) {
  const rendered = painted ?? model
  const marginEditing =
    editingKind === 'document'
      ? undefined
      : editingStoryFor(rendered, editingKind)
  // `PAGEREF` fields resolve through the laid-out pages, so the map is built
  // once per layout pass rather than per paragraph render.
  const pageReferences = useMemo(
    () => pageReferenceMap(rendered, pages),
    [rendered, pages],
  )
  // The paragraphs the batch removes outright — the applied marks — are the
  // ones the paint strikes through. A runless paragraph carrying typed text
  // still shows that text, so the implicit replacements in the effective set
  // stay visible; a refused last-paragraph mark stays painted too. The set is
  // shared with the save via `batchParagraphDeletions`, not the raw marks.
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
            onSelectParagraph={selectParagraph}
            onTextSelection={(paragraphId, from, to, direction) => {
              setFormatRange({ from, to })
              mirrorSelection(paragraphId, from, to, direction)
            }}
            selectionSegments={selectionSegments}
            linkOverlays={linkOverlays}
            selectionHandlers={selectionHandlers}
            onFocusParagraph={focusParagraph}
            onMoveCaret={moveCaret}
            drafts={drafts.drafts}
            emphasis={drafts.format.emphasis}
            onRunTextChange={(runId, text) =>
              drafts.setDrafts((current) => ({
                ...current,
                [runId]: text,
              }))
            }
            editing
            presence={presence}
            currentUserId={currentUserId}
            inserts={drafts.inserts}
            deletedParagraphIds={paintedDeletes}
            extraRuns={drafts.extraRuns}
            imageUrls={imageUrls}
            onInsertTextChange={(clientId, text) =>
              drafts.setInserts((current) =>
                current.map((item) =>
                  item.clientId === clientId ? { ...item, text } : item,
                ),
              )
            }
            onInsertParagraph={(afterParagraphId) =>
              selectParagraph(drafts.insertAfter(afterParagraphId), 0)
            }
            onDeleteParagraph={(paragraphId) => {
              const { selectId } = drafts.deleteParagraph(paragraphId)
              if (selectId) selectParagraph(selectId)
            }}
            onWordEdit={(edit) => {
              const outcome = drafts.handleWordEdit(model, edit)
              if (outcome?.status === 'applied') {
                selectParagraph(outcome.caret.paragraphId, outcome.caret.offset)
              } else if (outcome?.status === 'refused') {
                reportJoinRefusal(outcome.refusal)
              }
            }}
            restoreCaret={restoreCaret}
            verticalCaret={verticalCaret}
          />
        </DocumentPage>
      ))}
    </>
  )
}
