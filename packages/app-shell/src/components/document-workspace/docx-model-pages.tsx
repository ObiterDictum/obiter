import type { DocumentModelWire, DocumentPresence } from '@obiter/contracts'
import { editingStoryFor } from '../../document-page-layout'
import type { LaidOutPage } from '../../document-page-engine'
import { documentDefaultFace } from '../../document-page-style'
import type { ParagraphLinkOverlay } from '../../document-structural-drafts'
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
}: {
  model: DocumentModelWire
  painted: DocumentModelWire | undefined
  pages: LaidOutPage[]
  zoom: number
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
}) {
  const rendered = painted ?? model
  const marginEditing =
    editingKind === 'document'
      ? undefined
      : editingStoryFor(rendered, editingKind)
  return (
    <>
      {pages.map((laid, index) => (
        <DocumentPage
          key={`page-${index + 1}`}
          zoom={zoom}
          width={laid.box.widthPx}
          height={laid.box.heightPx}
          fontFamily={documentDefaultFace(model.styles).fontFamily}
        >
          <DocumentModelPage
            model={rendered}
            marginEditing={marginEditing}
            onExitMarginEditing={onExitMarginEditing}
            pageNumber={index + 1}
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
            deletedParagraphIds={drafts.deletedParagraphIds}
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
