import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentPresence,
} from '@obiter/contracts'
import type { LocalInsert } from '../../document-edits'
import {
  emptyFormatDrafts,
  type PendingEmphasis,
} from '../../document-format-types'
import {
  cellWrapWidthPx,
  type DisplayTableCell,
} from '../../document-page-tables'
import type { LaidOutBlock } from '../../document-page-engine'
import type { PageFloat, PageTextBox } from '../../document-page-floats'
import {
  contrastFillText,
  imagePartNameForDrawing,
} from '../../document-page-media'
import { documentListMarkers } from '../../document-page-lists'
import type { NoteKind } from '../../document-page-notes'
import type { ParagraphSelectionRange } from './model-run'
import { ModelParagraph, type ParagraphWordEdit } from './model-paragraph'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import {
  type ParagraphNeighborResolver,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import { PageTable } from './page-table'
import { PendingInsert } from './pending-insert'
import { PageDrawing } from './page-drawing'

/**
 * What one laid-out block needs to render itself: the model, the draft state
 * the workspace is editing, and the document selection so an unselected block
 * still paints its selected segments.
 */
export type BlockContext = {
  model: DocumentModelWire
  storyPartName: string
  selectedParagraphId: string | null
  onSelectParagraph: (paragraphId: string, offset?: number) => void
  onTextSelection?: (
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) => void
  drafts?: Record<string, string>
  emphasis?: readonly PendingEmphasis[]
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  onInsertTextChange?: (clientId: string, text: string) => void
  onInsertParagraph?: (afterParagraphId: string) => void
  onDeleteParagraph?: (paragraphId: string) => void
  onJoinPrevious?: (paragraphId: string) => boolean | void
  onWordEdit?: (edit: ParagraphWordEdit) => void
  restoreCaret?: { paragraphId: string; offset: number } | null
  verticalCaret?: VerticalCaretColumn
  imageUrls: Record<string, string>
  paragraphs: DocumentParagraphWire[]
  listMarkers: ReturnType<typeof documentListMarkers>
  noteMarks: Map<string, { mark: string; kind: NoteKind }>
  noteParagraphIds: Set<string>
  storyOf: (paragraphId: string) => { kind: string; partName: string }
  columnWidthPx: number
  selectionSegments: ReadonlyMap<string, ParagraphSelectionRange>
  selectionHandlers?: ParagraphSelectionHandlers
  neighbors?: ParagraphNeighborResolver
  onFocusParagraph?: (paragraphId: string) => void
  /** A plain-arrow crossing. Distinct from a click, which may place the caret
   * in a table cell that the selection flow does not cover. */
  onMoveCaret?: (paragraphId: string, offset: number) => void
}

export function renderBlock(
  block: LaidOutBlock,
  index: number,
  ctx: BlockContext,
) {
  if (block.type === 'table') {
    const cellColumnCounts = new Map<DisplayTableCell, number>()
    for (const row of block.table.rows) {
      for (const cell of row.cells) {
        cellColumnCounts.set(cell, row.cells.length)
      }
    }
    const nodes = [
      <PageTable
        key={`tbl-${index}`}
        table={block.table}
        renderCell={(cell) =>
          cell.paragraphIds.flatMap((id) => {
            const paragraph = ctx.paragraphs.find((item) => item.id === id)
            if (!paragraph || ctx.deletedParagraphIds.includes(paragraph.id)) {
              return []
            }
            const wrapWidthPx = cellWrapWidthPx(
              cell,
              ctx.columnWidthPx,
              cellColumnCounts.get(cell) ?? 1,
            )
            return [
              <ModelParagraph
                key={paragraph.id}
                paragraph={paragraph}
                changes={ctx.model.changes}
                selected={ctx.selectedParagraphId === paragraph.id}
                onSelectParagraph={ctx.onSelectParagraph}
                drafts={ctx.drafts}
                emphasis={ctx.emphasis}
                onRunTextChange={ctx.onRunTextChange}
                onInsertParagraph={ctx.onInsertParagraph}
                onDeleteParagraph={ctx.onDeleteParagraph}
                onJoinPrevious={ctx.onJoinPrevious}
                onWordEdit={ctx.onWordEdit}
                onMoveCaret={ctx.onMoveCaret ?? ctx.onSelectParagraph}
                onTextSelection={ctx.onTextSelection}
                neighbors={ctx.neighbors}
                restoreCaret={ctx.restoreCaret}
                verticalCaret={ctx.verticalCaret}
                editing={ctx.editing}
                presence={ctx.presence}
                currentUserId={ctx.currentUserId}
                storyPartName={ctx.storyPartName}
                relationships={ctx.model.relationships}
                imageUrls={ctx.imageUrls}
                styles={ctx.model.styles}
                listMarker={ctx.listMarkers.get(paragraph.id)}
                wrapWidthPx={wrapWidthPx}
                noteMark={ctx.noteMarks.get(paragraph.id)?.mark}
                noteKind={ctx.noteMarks.get(paragraph.id)?.kind}
                story={ctx.storyOf(paragraph.id)}
              />,
            ]
          })
        }
      />,
    ]
    return nodes
  }

  const paragraph = block.paragraph
  if (ctx.deletedParagraphIds.includes(paragraph.id)) return []
  const insert = ctx.inserts.find((item) => item.clientId === paragraph.id)
  if (insert) {
    return [
      <PendingInsert
        key={insert.clientId}
        insert={insert}
        selected={ctx.selectedParagraphId === insert.clientId}
        verticalCaret={ctx.verticalCaret}
        onSelect={() => ctx.onSelectParagraph(insert.clientId)}
        onTextChange={ctx.onInsertTextChange}
        onInsertParagraph={ctx.onInsertParagraph}
        onDeleteParagraph={ctx.onDeleteParagraph}
        onJoinPrevious={ctx.onJoinPrevious}
        onWordEdit={ctx.onWordEdit}
        restoreCaret={ctx.restoreCaret}
      />,
    ]
  }
  return [
    <ModelParagraph
      key={`${paragraph.id}-${block.from ?? 0}`}
      paragraph={paragraph}
      changes={ctx.model.changes}
      selected={ctx.selectedParagraphId === paragraph.id}
      onSelectParagraph={ctx.onSelectParagraph}
      drafts={ctx.drafts}
      emphasis={ctx.emphasis}
      onRunTextChange={ctx.onRunTextChange}
      onInsertParagraph={ctx.onInsertParagraph}
      onDeleteParagraph={ctx.onDeleteParagraph}
      onJoinPrevious={ctx.onJoinPrevious}
      onWordEdit={ctx.onWordEdit}
      onMoveCaret={ctx.onMoveCaret ?? ctx.onSelectParagraph}
      onTextSelection={ctx.onTextSelection}
      neighbors={ctx.neighbors}
      selectionSegment={ctx.selectionSegments.get(paragraph.id) ?? null}
      selectionHandlers={ctx.selectionHandlers}
      onFocusParagraph={
        ctx.onFocusParagraph
          ? () => ctx.onFocusParagraph?.(paragraph.id)
          : undefined
      }
      restoreCaret={ctx.restoreCaret}
      verticalCaret={ctx.verticalCaret}
      editing={ctx.editing && !ctx.noteParagraphIds.has(paragraph.id)}
      presence={ctx.presence}
      currentUserId={ctx.currentUserId}
      storyPartName={ctx.storyPartName}
      relationships={ctx.model.relationships}
      imageUrls={ctx.imageUrls}
      styles={ctx.model.styles}
      from={block.from}
      to={block.to}
      padLeftPx={block.padLeftPx}
      padRightPx={block.padRightPx}
      wrapWidthPx={block.wrapWidthPx}
      continuation={block.continuation}
      pageStart={block.pageStart}
      listMarker={ctx.listMarkers.get(paragraph.id)}
      noteMark={ctx.noteMarks.get(paragraph.id)?.mark}
      noteKind={ctx.noteMarks.get(paragraph.id)?.kind}
      story={ctx.storyOf(paragraph.id)}
    />,
  ]
}

/**
 * Page-level floats and text boxes: absolutely positioned on top of the laid
 * out body, so they travel with the page rather than with a block. Text boxes
 * are not editable, but a model selection can cover their paragraphs, so they
 * paint the derived segment like any other paragraph.
 */
export function PageOverlays({
  floats,
  textBoxes,
  frame,
  model,
  storyPartName,
  paragraphs,
  storyOf,
  drafts,
  emphasis = emptyFormatDrafts.emphasis,
  imageUrls,
  selectionSegments,
  selectionHandlers,
}: {
  floats: PageFloat[]
  textBoxes: PageTextBox[]
  frame: { left: number; top: number }
  model: DocumentModelWire
  storyPartName: string
  paragraphs: DocumentParagraphWire[]
  storyOf: (paragraphId: string) => { kind: string; partName: string }
  drafts?: Record<string, string>
  emphasis?: readonly PendingEmphasis[]
  imageUrls: Record<string, string>
  selectionSegments: ReadonlyMap<string, ParagraphSelectionRange>
  selectionHandlers?: ParagraphSelectionHandlers
}) {
  return (
    <>
      {floats.map((item, index) => {
        const partName = imagePartNameForDrawing(
          item.xml,
          storyPartName,
          model.relationships,
        )
        return (
          <div
            key={`float-${index}`}
            className="pointer-events-none absolute"
            style={{
              left: item.leftPx - frame.left,
              top: item.topPx - frame.top,
              zIndex: item.behind ? 0 : 2,
            }}
          >
            <PageDrawing
              xml={item.xml}
              ignoreAnchor
              imageUrl={partName ? imageUrls[partName] : undefined}
              fallbackLabel="Document image"
            />
          </div>
        )
      })}
      {textBoxes.map((box, index) => (
        <div
          key={`txbx-${index}`}
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: box.leftPx - frame.left,
            top: box.topPx - frame.top,
            width: box.widthPx,
            height: box.heightPx,
            backgroundColor: box.fill,
            color: contrastFillText(box.fill),
            zIndex: box.behind ? 0 : 2,
          }}
        >
          {box.paragraphIds.flatMap((id) => {
            const paragraph = paragraphs.find((item) => item.id === id)
            if (!paragraph) return []
            return [
              <ModelParagraph
                key={paragraph.id}
                paragraph={paragraph}
                changes={model.changes}
                selected={false}
                onSelectParagraph={() => undefined}
                selectionSegment={selectionSegments.get(paragraph.id) ?? null}
                selectionHandlers={selectionHandlers}
                drafts={drafts}
                emphasis={emphasis}
                editing={false}
                storyPartName={storyPartName}
                story={storyOf(paragraph.id)}
                relationships={model.relationships}
                imageUrls={imageUrls}
                styles={model.styles}
              />,
            ]
          })}
        </div>
      ))}
    </>
  )
}
